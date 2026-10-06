---
type: llm
---

PASS if the answer says collection proxies load a collection into a separate game world (new socket, own physics world, loaded/initialized/enabled with load/async_load, init, enable messages and unloaded with unload, with proxy_loaded/proxy_unloaded notifications), and that collection factories spawn the objects of a collection into the current world (collectionfactory.create returning a table of ids). It should recommend proxies for separate levels or screens.
FAIL if it confuses the two or invents APIs.
