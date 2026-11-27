"""Free voice providers for UAOS1, backed by the UAO server's own Jarvis endpoints.

- JarvisSTT   -> POST {UAO_API_BASE}/api/jarvis/transcribe   {audioBase64, mimeType}
- JarvisTTS   -> POST {UAO_API_BASE}/api/jarvis/tts          {text, voice?}   (Gemini -> Piper -> MiniMax chain)
- JarvisBrain -> POST {UAO_API_BASE}/api/jarvis/chat/stream  {text}  (SSE: delta / done)

No Fish, Anthropic or LiveKit Cloud keys. The brain can take a minute or more (Grok Bot / Hermes behind
the bridge), so it speaks a short acknowledgement when the answer is slow, then the answer when it lands.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import time
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx
from livekit import rtc
from livekit.agents import APIConnectionError, APIConnectOptions, APIStatusError, stt, tts
from livekit.agents.language import LanguageCode
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, NOT_GIVEN, FlushSentinel, NotGivenOr
from livekit.agents.utils import AudioBuffer

log = logging.getLogger("os1.free")

DEFAULT_BASE = "https://server.tail85e19.ts.net:8444"


def uao_base() -> str:
    return (os.environ.get("UAO_API_BASE") or DEFAULT_BASE).strip().rstrip("/")


def _headers() -> dict[str, str]:
    token = os.environ.get("UAO_TOKEN", "").strip()
    return {"Authorization": f"Bearer {token}"} if token else {}


def enabled() -> bool:
    """Free providers unless OS1_VOICE_PROVIDERS=fish (or unset with a Fish key present)."""
    mode = os.environ.get("OS1_VOICE_PROVIDERS", "").strip().lower()
    if mode in ("free", "jarvis", "uao"):
        return True
    if mode == "fish":
        return False
    return not os.environ.get("FISH_API_KEY", "").strip()


# ------------------------------------------------------------------ speech to text


STT_RATE = 16000
STT_CHUNK_S = float(os.environ.get("UAOS1_STT_CHUNK_S", "15"))


def wav_chunks(buffer: AudioBuffer, *, rate: int, max_seconds: float) -> list[bytes]:
    """Mix down to mono, resample to `rate`, and split into WAV files of at most `max_seconds`."""
    frame = rtc.combine_audio_frames(buffer)
    if frame.num_channels != 1 or frame.sample_rate != rate:
        resampler = rtc.AudioResampler(frame.sample_rate, rate, num_channels=frame.num_channels)
        out = [*resampler.push(frame), *resampler.flush()]
        frame = rtc.combine_audio_frames(out) if out else frame
        if frame.num_channels != 1:
            import numpy as np

            pcm = np.frombuffer(frame.data, dtype=np.int16).reshape(-1, frame.num_channels).mean(axis=1)
            frame = rtc.AudioFrame(pcm.astype(np.int16).tobytes(), frame.sample_rate, 1, len(pcm))
    per = int(frame.sample_rate * max_seconds)
    pcm = bytes(frame.data)
    step = per * 2 * frame.num_channels
    chunks = []
    for i in range(0, len(pcm), step):
        part = pcm[i : i + step]
        n = len(part) // (2 * frame.num_channels)
        if n:
            chunks.append(rtc.AudioFrame(part, frame.sample_rate, frame.num_channels, n).to_wav_bytes())
    return chunks


class JarvisSTT(stt.STT):
    """Batch STT; wrap with stt.StreamAdapter(stt=..., vad=...) for live turns."""

    def __init__(self, *, base_url: str | None = None, timeout: float = 30.0) -> None:
        super().__init__(capabilities=stt.STTCapabilities(streaming=False, interim_results=False))
        self._base = (base_url or uao_base()).rstrip("/")
        self._timeout = timeout

    @property
    def model(self) -> str:
        return "uao-jarvis-transcribe"

    @property
    def provider(self) -> str:
        return "uao"

    async def _recognize_impl(
        self,
        buffer: AudioBuffer,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions,
    ) -> stt.SpeechEvent:
        texts: list[str] = []
        lang = LanguageCode("en")
        timeout = httpx.Timeout(self._timeout, connect=conn_options.timeout)
        async with httpx.AsyncClient(timeout=timeout) as c:
            # 16 kHz mono in <=15 s pieces keeps every request well under the server's upload limit
            # (full-rate audio of a long utterance was rejected with 413).
            for wav in wav_chunks(buffer, rate=STT_RATE, max_seconds=STT_CHUNK_S):
                body = {"audioBase64": base64.b64encode(wav).decode(), "mimeType": "audio/wav"}
                try:
                    resp = await c.post(f"{self._base}/api/jarvis/transcribe", json=body, headers=_headers())
                except httpx.HTTPError as exc:
                    raise APIConnectionError(f"transcribe unreachable: {exc.__class__.__name__}") from exc
                if resp.status_code >= 400:
                    raise APIStatusError(resp.text[:200], status_code=resp.status_code, body=resp.text[:500])
                data = resp.json()
                if str(data.get("text") or "").strip():
                    texts.append(str(data["text"]).strip())
                lang = LanguageCode(str(data.get("language") or "en"))
        text = " ".join(texts)
        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[stt.SpeechData(text=text, language=lang)],
        )


# ------------------------------------------------------------------ text to speech


class JarvisTTS(tts.TTS):
    def __init__(self, *, voice: str | None = None, base_url: str | None = None, sample_rate: int = 24000) -> None:
        super().__init__(capabilities=tts.TTSCapabilities(streaming=False), sample_rate=sample_rate, num_channels=1)
        self._voice = (voice or os.environ.get("UAOS1_TTS_VOICE", "")).strip()
        self._base = (base_url or uao_base()).rstrip("/")
        # "" = the server's own chain (Gemini -> Piper -> MiniMax). UAOS1_TTS_PROVIDER=piper forces one.
        self._forced = os.environ.get("UAOS1_TTS_PROVIDER", "").strip()
        self._chain_down_until = 0.0  # after the chain fails, go straight to Piper for a while

    def providers(self) -> list[str]:
        if self._forced:
            return [self._forced]
        if time.monotonic() < self._chain_down_until:
            return ["piper"]
        return ["", "piper"]

    def chain_failed(self) -> None:
        self._chain_down_until = time.monotonic() + float(os.environ.get("UAOS1_TTS_CHAIN_COOLDOWN_S", "600"))

    @property
    def model(self) -> str:
        return "uao-jarvis-tts"

    @property
    def provider(self) -> str:
        return "uao"

    def synthesize(
        self, text: str, *, conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS
    ) -> tts.ChunkedStream:
        return _JarvisChunkedStream(tts=self, input_text=text, conn_options=conn_options)


class _JarvisChunkedStream(tts.ChunkedStream):
    def __init__(self, *, tts: JarvisTTS, input_text: str, conn_options: APIConnectOptions) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._jtts = tts

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        text = self.input_text.strip()
        if not text:
            return
        timeout = httpx.Timeout(60.0, connect=self._conn_options.timeout)
        url = f"{self._jtts._base}/api/jarvis/tts"
        last_error: Exception | None = None
        async with httpx.AsyncClient(timeout=timeout) as c:
            for provider in self._jtts.providers():
                body: dict[str, Any] = {"text": text}
                if self._jtts._voice:
                    body["voice"] = self._jtts._voice
                if provider:
                    body["provider"] = provider
                try:
                    resp = await c.post(url, json=body, headers=_headers())
                except httpx.HTTPError as exc:
                    last_error = APIConnectionError(f"tts unreachable: {exc.__class__.__name__}")
                    continue
                mime = resp.headers.get("content-type", "").split(";")[0].strip()
                if resp.status_code >= 400 or not mime.startswith("audio/") or resp.content[:4] != b"RIFF":
                    # The chain can fail as a whole (e.g. Gemini quota + a server bug on fallback); try Piper.
                    log.warning("tts via %s failed: %s %s", provider or "chain", resp.status_code, resp.text[:160])
                    if not provider:
                        self._jtts.chain_failed()
                    last_error = APIStatusError(resp.text[:200], status_code=resp.status_code or 502)
                    continue
                output_emitter.initialize(
                    request_id=uuid.uuid4().hex,
                    sample_rate=self._jtts.sample_rate,
                    num_channels=1,
                    mime_type="audio/wav",
                )
                output_emitter.push(resp.content)
                output_emitter.flush()
                return
        raise last_error or APIConnectionError("no tts provider produced audio")


# ------------------------------------------------------------------ brain


_MARKDOWN = re.compile(r"(\*\*|__|`+|^#+\s*|^\s*[-*]\s+)", re.MULTILINE)


def speakable(text: str) -> str:
    text = re.sub(r"https?://\S+", "a link", text)
    return _MARKDOWN.sub("", text).strip()


HANDOFF_MARK = "\x00handoff"  # internal: the fast model passed this turn to Jarvis

FAST_SYSTEM = """You are Samantha, the voice of UAOS1, talking out loud with the user.
Speak naturally and warmly, in one to three short sentences. No lists, markdown, emoji or URLs.
If answering needs tools, live or personal data (email, calendar, files, the web, today's news,
weather, prices), or doing something (sending, booking, running a task, opening or changing
anything), reply with exactly HANDOFF and nothing else. Otherwise just answer."""


class JarvisBrain:
    """Same interface as Brain.stream(history, note); the words come from the UAO Jarvis chat route."""

    def __init__(self, *, base_url: str | None = None) -> None:
        self._base = (base_url or uao_base()).rstrip("/")
        self.ack_after_s = float(os.environ.get("UAOS1_ACK_AFTER_S", "2.5"))
        self.give_up_s = float(os.environ.get("UAOS1_BRAIN_TIMEOUT_S", "180"))
        self.ack = os.environ.get("UAOS1_ACK_LINE", "On it, one moment.")
        self.still = os.environ.get("UAOS1_STILL_LINE", "Still working on that.")
        # Called with the answer when a reply finishes after its turn was cancelled (you spoke again
        # before a slow answer arrived). The agent speaks it then, so slow answers are never lost.
        self.on_late: Callable[[str], Any] | None = None
        # Fast path: an OpenAI-compatible chat model (the server's model router) answers quick
        # questions in a second or two; anything needing tools or live data is handed to Jarvis.
        self.fast_url = os.environ.get("UAOS1_FAST_LLM_URL", "").rstrip("/")
        self.fast_model = os.environ.get("UAOS1_FAST_LLM_MODEL", "auto/best-chat")
        self.fast_key = os.environ.get("UAOS1_FAST_LLM_KEY", "")
        if self.fast_url and "UAOS1_ACK_AFTER_S" not in os.environ:
            # The fast model usually starts within ~3 s; a hand-off to Jarvis acknowledges at once.
            self.ack_after_s = 6.0

    async def _fast_deltas(self, history: list[dict[str, str]], note: str | None) -> AsyncIterator[str]:
        system = FAST_SYSTEM + (f"\n\nContext for this turn: {note}" if note else "")
        msgs = [{"role": "system", "content": system}]
        msgs += [
            {"role": m["role"], "content": m["content"]}
            for m in history[-10:]
            if m.get("role") in ("user", "assistant") and m.get("content")
        ]
        body = {"model": self.fast_model, "messages": msgs, "stream": True, "max_tokens": 300, "temperature": 0.7}
        headers = {"Authorization": f"Bearer {self.fast_key}"} if self.fast_key else {}
        timeout = httpx.Timeout(8.0, read=20.0)
        in_think = False
        async with (
            httpx.AsyncClient(timeout=timeout) as c,
            c.stream("POST", f"{self.fast_url}/v1/chat/completions", json=body, headers=headers) as resp,
        ):
            if resp.status_code >= 400:
                raise RuntimeError(f"fast model {resp.status_code}")
            async for line in resp.aiter_lines():
                if not line.startswith("data:") or line.strip() == "data: [DONE]":
                    continue
                try:
                    ev = json.loads(line[5:].strip())
                    d = ev["choices"][0].get("delta", {}).get("content") or ""
                except (ValueError, KeyError, IndexError):
                    continue
                # Reasoning models put their thinking in <think>…</think>: never speak it.
                while d:
                    if in_think:
                        end = d.find("</think>")
                        if end < 0:
                            d = ""
                        else:
                            in_think, d = False, d[end + 8 :]
                    else:
                        start = d.find("<think>")
                        if start < 0:
                            yield d
                            d = ""
                        else:
                            if start:
                                yield d[:start]
                            in_think, d = True, d[start + 7 :]

    async def _answer(self, history: list[dict[str, str]], note: str | None, text: str) -> AsyncIterator[str]:
        """Fast model first; Jarvis (tools, live data, actions) when it says HANDOFF or fails."""
        if self.fast_url:
            pre, decided = "", False
            try:
                async for d in self._fast_deltas(history, note):
                    if decided:
                        yield d
                        continue
                    pre += d
                    head = pre.lstrip()
                    if head.upper().startswith("HANDOFF") or (len(head) < 7 and "HANDOFF".startswith(head.upper())):
                        if head.upper().startswith("HANDOFF"):
                            yield HANDOFF_MARK
                            break
                        continue
                    decided = True
                    yield pre
                else:
                    if not decided and pre.strip():
                        yield pre
                    if decided or pre.strip():
                        return
            except Exception as exc:  # noqa: BLE001
                if decided:
                    raise
                log.warning("fast model failed, using Jarvis: %s", exc)
        async for d in self._deltas(text):
            yield d

    async def _deltas(self, text: str) -> AsyncIterator[str]:
        body = {"text": text, "source": "uaos1-voice"}
        timeout = httpx.Timeout(15.0, read=self.give_up_s)
        url = f"{self._base}/api/jarvis/chat/stream"
        async with (
            httpx.AsyncClient(timeout=timeout) as c,
            c.stream("POST", url, json=body, headers=_headers()) as resp,
        ):
            if resp.status_code >= 400:
                raise RuntimeError(f"jarvis chat {resp.status_code}")
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                try:
                    ev = json.loads(line[5:].strip())
                except ValueError:
                    continue
                if ev.get("type") == "delta" and ev.get("delta"):
                    yield str(ev["delta"])
                elif ev.get("type") == "done":
                    if ev.get("failed"):
                        raise RuntimeError("jarvis reported a failed turn")
                    return
                elif ev.get("type") == "error":
                    raise RuntimeError(str(ev.get("error") or "jarvis error"))

    async def stream(
        self, history: list[dict[str, str]], note: str | None = None
    ) -> AsyncIterator[str | FlushSentinel]:
        last = next((m["content"] for m in reversed(history) if m.get("role") == "user" and m.get("content")), "")
        if not last.strip():
            return
        # On-screen actions ("open atlas") already happened locally: confirm instantly, no Jarvis round trip.
        action = re.search(r'An on-screen action just happened: "(.+?)"', note or "")
        if action:
            yield speakable(action.group(1))
            return
        # The worker's notes are stage directions for its own persona; Jarvis has its own, so send only
        # the words — except helper reports, which are the content itself.
        text = last

        queue: asyncio.Queue[tuple[str, str | None]] = asyncio.Queue()

        async def pump() -> None:
            try:
                async for d in self._answer(history, note, text):
                    if d is HANDOFF_MARK:
                        await queue.put(("handoff", None))
                    else:
                        await queue.put(("delta", d))
                await queue.put(("done", None))
            except Exception as exc:  # noqa: BLE001
                log.warning("jarvis brain failed: %s", exc)
                await queue.put(("error", str(exc)))

        task = asyncio.create_task(pump())
        spoke_ack = False
        got_any = False
        finished = False
        buf = ""
        waited = 0.0
        try:
            while True:
                timeout = self.ack_after_s if not spoke_ack and not got_any else 45.0
                try:
                    kind, value = await asyncio.wait_for(queue.get(), timeout=timeout)
                except TimeoutError:
                    waited += timeout
                    if not got_any and not spoke_ack:
                        spoke_ack = True
                        yield self.ack + " "
                        yield FlushSentinel()  # short lines would otherwise wait for the next sentence
                    elif not got_any and waited < self.give_up_s:
                        yield self.still + " "
                        yield FlushSentinel()
                    elif not got_any:
                        finished = True
                        yield "That's taking too long. The answer will land in your Jarvis chat."
                        return
                    continue
                if kind == "handoff":
                    if not spoke_ack and not got_any:
                        spoke_ack = True
                        yield self.ack + " "
                        yield FlushSentinel()
                    continue
                if kind == "delta" and value:
                    got_any = True
                    buf += value
                    # Speak whole sentences as they complete so TTS gets natural chunks.
                    while (m := re.search(r"[.!?](\s|$)", buf)) is not None:
                        cut = m.end()
                        yield speakable(buf[:cut]) + " "
                        yield FlushSentinel()
                        buf = buf[cut:]
                elif kind == "done":
                    finished = True
                    if buf.strip():
                        yield speakable(buf)
                    if not got_any:
                        yield "Done."
                    return
                else:
                    finished = True
                    if not got_any:
                        yield "I couldn't reach Jarvis just now."
                    return
        finally:
            if not finished and not got_any and not task.done() and self.on_late is not None:
                # The turn was cancelled before any of the answer was spoken: keep the request alive.
                asyncio.ensure_future(self._deliver_late(queue, task))
            elif not task.done():
                task.cancel()

    async def _deliver_late(self, queue: asyncio.Queue[tuple[str, str | None]], task: asyncio.Task[None]) -> None:
        answer = ""
        try:
            while True:
                kind, value = await asyncio.wait_for(queue.get(), timeout=self.give_up_s)
                if kind == "delta" and value:
                    answer += value
                elif kind in ("done", "error"):
                    break
        except TimeoutError:
            task.cancel()
            return
        answer = speakable(answer)
        if answer and self.on_late is not None:
            log.info("speaking a late Jarvis answer (%d chars)", len(answer))
            try:
                res = self.on_late(answer)
                if asyncio.iscoroutine(res):
                    await res
            except Exception as exc:  # noqa: BLE001
                log.warning("could not speak late answer: %s", exc)
