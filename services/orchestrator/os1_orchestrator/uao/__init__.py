"""UAO bridge: Apps & services (Homarr catalogue) and Atlas agents, proxied over the tailnet.

The renderer never talks to the server directly; every call goes through these /os1/uao/* routes
so tokens stay in the orchestrator and the same code can serve Android later.
"""
