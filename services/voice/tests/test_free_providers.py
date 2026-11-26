"""JarvisBrain: speaks a flushed acknowledgement for slow answers, and never loses an answer when the
turn is cancelled before it arrives (you spoke again while Jarvis was still thinking)."""

from __future__ import annotations

import asyncio

from livekit.agents.types import FlushSentinel

from os1_voice.free_providers import JarvisBrain, speakable


def slow_brain(delay: float, text: str = "The answer. Second part!") -> JarvisBrain:
    b = JarvisBrain(base_url="http://127.0.0.1:9")
    b.fast_url = ""  # Jarvis-only path
    b.ack_after_s = 0.05

    async def deltas(_text: str):
        await asyncio.sleep(delay)
        for word in text.split(" "):
            yield word + " "

    b._deltas = deltas  # type: ignore[method-assign]
    return b


def test_ack_is_flushed_then_answer_sentences():
    async def run():
        out = [c async for c in slow_brain(0.2).stream([{"role": "user", "content": "hi"}])]
        return out

    out = asyncio.run(run())
    assert out[0].startswith("On it") and isinstance(out[1], FlushSentinel)
    spoken = "".join(c for c in out if isinstance(c, str))
    assert "The answer." in spoken and "Second part!" in spoken
    assert sum(isinstance(c, FlushSentinel) for c in out) >= 3


def test_cancelled_turn_delivers_late_answer():
    async def run():
        b = slow_brain(0.3)
        heard: list[str] = []
        b.on_late = heard.append
        gen = b.stream([{"role": "user", "content": "slow question"}])
        first = await gen.__anext__()  # the acknowledgement
        await gen.aclose()  # the user spoke again: this turn is cancelled
        await asyncio.sleep(0.6)
        return first, heard

    first, heard = asyncio.run(run())
    assert first.startswith("On it")
    assert heard == ["The answer. Second part!"]


def test_speakable_strips_markdown_and_urls():
    assert speakable("**Done** see https://x.y/z\n- item") == "Done see a link\nitem"


def test_on_screen_actions_confirm_without_jarvis():
    async def run():
        b = slow_brain(10.0)
        note = 'Overlay. An on-screen action just happened: "Showing atlas." Acknowledge it naturally.'
        return [c async for c in b.stream([{"role": "user", "content": "open atlas"}], note)]

    assert asyncio.run(asyncio.wait_for(run(), 1.0)) == ["Showing atlas."]


def routed_brain(fast_words: list[str], *, fail: bool = False) -> tuple[JarvisBrain, list[str]]:
    b = JarvisBrain(base_url="http://127.0.0.1:9")
    b.fast_url = "http://127.0.0.1:9"
    b.ack_after_s = 5
    calls: list[str] = []

    async def fast(_history, _note):
        if fail:
            raise RuntimeError("router down")
        for w in fast_words:
            yield w

    async def jarvis(text: str):
        calls.append(text)
        yield "Jarvis answer."

    b._fast_deltas = fast  # type: ignore[method-assign]
    b._deltas = jarvis  # type: ignore[method-assign]
    return b, calls


def _spoken(b: JarvisBrain) -> str:
    async def run():
        return [c async for c in b.stream([{"role": "user", "content": "what's on my calendar"}])]

    return "".join(c for c in asyncio.run(run()) if isinstance(c, str))


def test_fast_model_answers_quick_questions_without_jarvis():
    b, calls = routed_brain(["Hello", " there", ", Tony."])
    assert "Hello there, Tony." in _spoken(b) and calls == []


def test_fast_model_handoff_goes_to_jarvis():
    b, calls = routed_brain(["HAND", "OFF"])
    out = _spoken(b)
    assert "Jarvis answer." in out and "HANDOFF" not in out and calls == ["what's on my calendar"]


def test_fast_model_failure_falls_back_to_jarvis():
    b, calls = routed_brain([], fail=True)
    assert "Jarvis answer." in _spoken(b) and calls
