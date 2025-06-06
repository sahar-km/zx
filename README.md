# VLESS Proxy Configuration Provider & Cloudflare Worker

This project provides a web interface for generating VLESS proxy configurations and includes a Cloudflare Worker script for handling the VLESS protocol and proxying traffic. It allows users to easily obtain VLESS configuration links for various clients and displays relevant network information.

## Features

- Web interface for VLESS configuration.
- Support for Xray and Sing-Box cores.
- Direct import links for various clients (Hiddify, V2rayNG, Clash Meta, NekoBox).
- Display of network information (proxy and client IP details, including ISP and location).
- Cloudflare Worker for handling VLESS protocol and proxying TCP/UDP traffic.
- DNS resolution over HTTPS for DNS queries (when UDP is directed to port 53).
- Customizable User UUID, Proxy IP, and DNS Resolver via Cloudflare Worker environment variables.

## Usage/Deployment

### Deploying the Cloudflare Worker

1.  The `index.js` file contains the Cloudflare Worker script.
2.  Create a new Worker in your Cloudflare account.
3.  Copy the content of `index.js` and paste it into the Cloudflare Worker editor.
4.  After deploying the Worker, Cloudflare will provide a URL for it (e.g., `https://your-worker-name.your-subdomain.workers.dev`).

### Environment Variables

Configure the following environment variables in your Cloudflare Worker settings:

*   `UUID`: Your VLESS User UUID. This is a mandatory field.
*   `PROXYIP`: (Optional) An IP address or domain name to be used as a proxy for the worker's outbound connections. If not set, the worker will connect directly to the target servers.
*   `DNS_RESOLVER`: (Optional) The DNS resolver to use for DNS queries. Defaults to `1.1.1.1` if not specified.

### Accessing the Configuration Page

The web interface for generating VLESS configurations is accessible by navigating to:

*   The root URL of your deployed Cloudflare Worker (e.g., `https://your-worker-name.your-subdomain.workers.dev/`)
*   Or, by appending your `UUID` to the path (e.g., `https://your-worker-name.your-subdomain.workers.dev/<UUID>`)

## Configuration Options

This section details the environment variables for the Cloudflare Worker:

*   `UUID`:
    *   **Purpose:** Defines the VLESS user ID. This UUID is part of the generated VLESS links and is used by the worker to authenticate clients.
    *   **Default:** The script has a default UUID, but it's strongly recommended to generate and use your own unique UUID (e.g., from [https://www.uuidgenerator.net/](https://www.uuidgenerator.net/)).
*   `PROXYIP`:
    *   **Purpose:** Specifies an IP address or domain name that the Cloudflare Worker will use as an intermediary proxy for outbound connections. This can be useful for routing traffic through a specific endpoint.
    *   **Default:** If not set or left empty, the worker will attempt to connect to the requested services directly. The `index.html` page will also use this value to display "Proxy Host" information.
*   `DNS_RESOLVER`:
    *   **Purpose:** Sets the IP address of the DNS resolver to be used by the worker for DNS-over-HTTPS (DoH) queries. This is specifically used when the worker handles UDP traffic destined for port 53.
    *   **Default:** `1.1.1.1` (Cloudflare's public DNS resolver).
*   `HTML_URL`:
    *   **Purpose:** (This is a constant in `index.js`, not an environment variable, but good to mention its role). This constant within the `index.js` script defines the URL from which the `index.html` content is fetched.
    *   **Customization:** If you wish to host your own modified version of the `index.html` page, you would need to update this constant directly in the `index.js` script before deploying the worker.

## How It Works

### Frontend (`index.html`)

*   Served by the Cloudflare Worker.
*   Displays VLESS configurations and network information.
*   Fetches proxy and client IP details using third-party services (`ipdata.co`, `ip-api.io`) and DNS resolution (`dns.google`).
*   Allows users to copy configuration links or import them into compatible clients.
*   The configurations displayed are dynamically generated by the worker based on its environment variables and the request details.

### Backend (Cloudflare Worker - `index.js`)

*   Acts as the VLESS server endpoint.
*   Handles incoming HTTP requests:
    *   Serves the `index.html` page (fetched from `HTML_URL`).
    *   Injects dynamic data (UUID, proxy IP, VLESS links) into the HTML before serving.
*   Handles WebSocket upgrade requests for VLESS connections.
*   Processes the VLESS protocol:
    *   Authenticates users based on the UUID.
    *   Parses requests for TCP or UDP proxying.
    *   Forwards TCP traffic to the requested destination (optionally via `PROXYIP`).
    *   Forwards UDP traffic (if port 53, for DNS) by making DNS-over-HTTPS requests to the configured `DNS_RESOLVER`.
*   Relays data between the client and the target service.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Disclaimer

**Disclaimer**

Users are responsible for ensuring that their use of this project and any proxy services complies with all applicable laws and regulations in their jurisdiction and the terms of service of any networks or services accessed. The developers of this project are not responsible for any misuse.
