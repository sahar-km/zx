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


# zx 

_A modern project powered by **HTML** and **JavaScript**_

![License](https://img.shields.io/github/license/sahar-km/zx)
![Top Language](https://img.shields.io/github/languages/top/sahar-km/zx)
![Last Commit](https://img.shields.io/github/last-commit/sahar-km/zx)

---

## ✨ Overview

**zx** is an innovative project utilizing cutting-edge web technologies to deliver awesome functionality with a clean, intuitive interface. Whether you’re a developer looking to contribute or a user wanting to check it out, you’re in the right place!

---

## 📦 Features

- ⚡ **Fast & Lightweight:** Built with efficiency in mind.
- 🎨 **Modern UI:** Clean, responsive design.
- 💡 **Easy to Use:** Minimal setup, intuitive experience.
- 🔧 **Customizable:** Tweak and extend as needed.
- 🌐 **100% Serverless:** No installs, just open and go!

---

## ⚙️ Getting Started

Clone the repo:

```bash
git clone https://github.com/sahar-km/zx.git
cd zx
```

Open `index.html` in your browser and you’re ready!

---

## 🛠️ Tech Stack

- **HTML** (66.1%)
- **JavaScript** (33.9%)

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

1. Fork the repository
2. Create your branch: `git checkout -b feature/awesome-feature`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature/awesome-feature`
5. Open a pull request

---

## 📄 License

This project is licensed under the MIT License.  
See [`LICENSE`](LICENSE) for details.

---

## 🙌 Acknowledgements

- Thanks to all contributors!
- Inspired by modern web development best practices.

---

## 📫 Contact

Questions or suggestions?  
Open an issue or reach out to [sahar-km on GitHub](https://github.com/sahar-km).

---

_Star ⭐ the repo if you like it!_

---

Let me know if you want to add project-specific instructions, screenshots, or badges!








### Credits

Many thanks to our awesome Chinese buddy, **zizifn!** [^4]  

[^1]: [UUID Generator](https://www.uuidgenerator.net/)

[^2]: [src/worker-vless.js](src/worker-vless.js)

[^3]: [List of ProxyIP](https://github.com/NiREvil/vless/blob/main/sub/ProxyIP.md)

[^4]:https://github.com/zizifn/edgetunnel
