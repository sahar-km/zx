# zizifn
Zizifn Edge tunnel is a proxy tool based on Cloudflare workers and Pages, supporting multiple protocols and configuration options.

## Cloudflare pages

### Environment Variables
variables required for Constructing pages.dev 

| variables | Examples | Values |
| -------- | ----------- | ---------------------------- |  
| UUID | `206b7ab3-2b7b-4784-9839-c617c7f73ce4` | To generate your own UUID refer to<br> [![UUID](https://img.shields.io/badge/ID_generator-gray?logo=lucid)](https://www.uuidgenerator.net) |
| PROXYIP | `nima.nscl.ir` <br>`turk.radicalization.ir` | To find proxyIP<br> [![ProxyIP](https://img.shields.io/badge/Check_here-gray?logo=envoyproxy)](https://github.com/NiREvil/vless/blob/main/sub/ProxyIP.md) |


## Cloudflare workers

If you intend to create a worker, you can proceed similarly to the page and utilize the same variables;

however, it is also possible to modify them directly within the code.  
To do this, you need to replace your "UUID" [^1] value in line `23` of "src/worker-vless.js file" [^2] ,
and the ProxyIP can be adjusted from line `26`.  

You can find some "proxyIPs" [^3] from this great repository, and there is even a guide on how to find new proxies included in the repo.


## View Configuration

- Visit your domain: `https://your-domain.pages.dev`
- Use specific UUID: `domain/uuid`
- Get subscription content: visit `domain/uuid`
- For Example: `https://zizifn-env.pages.dev/9ff8589993d34-4560-a1f0-5dc5b127fb00`

---

### Credits

Many thanks to our awesome Chinese buddy, **zizifn!** [^4]  

[^1]: [UUID Generator](https://www.uuidgenerator.net/)

[^2]: [src/worker-vless.js](src/worker-vless.js)

[^3]: [List of ProxyIP](https://github.com/NiREvil/vless/blob/main/sub/ProxyIP.md)

[^4]:https://github.com/zizifn/edgetunnel
