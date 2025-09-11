// @ts-ignore
import { connect } from 'cloudflare:sockets';

const DEFAULT_USER_ID = 'd342d11e-d424-4583-b36e-524ab1f0afa4';
const DEFAULT_PROXY_IPS = ['nima.nscl.ir:443'];
const CONSTANTS = {
  // VLESS protocol related constants (decoded from base64)
  VLESS_PROTOCOL: 'vless',
  AT_SYMBOL: '@',
  CUSTOM_SUFFIX: 'diana',

  // Subscription generation constants
  HTTP_PORTS: new Set([80]),
  HTTPS_PORTS: new Set([443]),
  URL_ED_PARAM: 'ed=2560',

  // Protocol header processing offsets
  PROTOCOL_OFFSETS: {
    VERSION: 0,
    UUID: 1,
    OPT_LENGTH: 17,
    COMMAND: 18,
    PORT: 19, // Relative to command
    ADDR_TYPE: 21, // Relative to command
    ADDR_LEN: 22, // Relative to command (for domain type)
    ADDR_VAL: 22, // Relative to command
  },

  // WebSocket ready states
  WS_READY_STATE_OPEN: 1,
  WS_READY_STATE_CLOSING: 2,
};

// Main Worker Logic
export default {
  async fetch(request, env, ctx) {
    try {
      const config = createRequestConfig(request, env);
      if (request.headers.get('Upgrade') !== 'websocket') return handleHttpRequest(request, config);

      return await handleWebSocketRequest(request, config);
    } catch (err) {
      return new Response(err?.toString() ?? 'Internal Error', { status: 500 });
    }
  },
};

/**
 * Handles all incoming HTTP (non-WebSocket) requests.
 * @param {Request} request The incoming request object.
 * @param {object} config The configuration object for this request.
 * @returns {Promise<Response>} A Response object.
 */
function handleHttpRequest(request, config) {
  const { url, host, proxyIP, proxyPort, userID } = config;
  const { pathname } = url;

  if (pathname === '/probe') {
    const cf = request.cf || {};
    const ip =
      request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
    return new Response(
      JSON.stringify(
        {
          ip,
          asn: cf.asn || '',
          isp: cf.asOrganization || cf.asnOrganization || '',
          city: cf.city || '',
          country: cf.country || '',
          colo: cf.colo || '',
        },
        null,
        2,
      ),
      {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      },
    );
  }

  if (pathname === '/scamalytics-lookup') {
    const ip = url.searchParams.get('ip');
    if (!ip) return new Response('Missing ip param', { status: 400 });
    return fetchScamalyticsData(ip, config.scamalytics);
  }

  const matchedUUID = findMatchingUserID(pathname, userID);
  if (matchedUUID) {
    if (pathname === `/${matchedUUID}`)
      return new Response(getBeautifulConfig(matchedUUID, host, `${proxyIP}:${proxyPort}`), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });

    if (pathname === `/sub/${matchedUUID}`) {
      const proxyPool = config.env.PROXYIP
        ? config.env.PROXYIP.split(',').map(x => x.trim())
        : [`${proxyIP}:${proxyPort}`];
      return new Response(GenSub(matchedUUID, host, proxyPool), {
        status: 200,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      });
    }

    if (pathname === `/ipsub/${matchedUUID}`) return generateIpSubscription(matchedUUID, host);
  }

  // Fallback to a helpful message if no other route matches
  const fallbackHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Worker Instructions</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; background-color: #1a1a1a; color: #e0e0e0; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1rem; box-sizing: border-box; }
            .container { text-align: left; padding: 2rem; border-radius: 8px; background-color: #2a2a2a; box-shadow: 0 4px 15px rgba(0,0,0,0.5); max-width: 700px; width: 100%; }
            h1 { text-align: center; color: #80bfff; margin-top: 0; }
            h2 { text-align: center; color: #57a6ff; margin-top: 2rem; margin-bottom: 1rem; border-bottom: 1px solid #444; padding-bottom: 0.5rem; }
            p { font-size: 1rem; line-height: 1.6; margin: 0.8rem 0; }
            code { display: block; background-color: #333; padding: 0.8rem; border-radius: 4px; font-family: "Courier New", Courier, monospace; font-size: 0.9rem; word-break: break-all; margin-top: 0.5rem; color: #a5d6ff; }
            strong { color: #ffffff; }
            hr { border: none; height: 1px; background-color: #444; margin: 1.5rem 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>How to Use This Worker</h1>
            <p>Please provide your User ID (UUID) in the URL to access the endpoints. Replace <code>${config.userID.split(',')[0]}</code> with your own UUID.</p>

            <hr>

            <p><strong>1. Main Configuration Page</strong><br>View individual configs and network info.</p>
            <code>https://${url.hostname}/${config.userID.split(',')[0]}</code>

            <p><strong>2. Standard Subscription Link</strong><br>A general-purpose subscription with multiple domains.</p>
            <code>https://${url.hostname}/sub/${config.userID.split(',')[0]}</code>

            <p><strong>3. Clean IP Subscription Link</strong><br>A subscription using a curated list of clean Cloudflare IPs.</p>
            <code>https://${url.hostname}/ipsub/${config.userID.split(',')[0]}</code>

            <h2>Optional Environment Variables</h2>
            <p>You can set these in your Cloudflare Worker's dashboard (Settings > Variables) to override the default configuration.</p>

            <p><strong>UUID</strong><br>Sets the user ID(s). Separate multiple UUIDs with a comma.</p>
            <code>d342d11e-d424-4583-b36e-524ab1f0afa4</code>

            <p><strong>PROXYIP</strong><br>Specifies backend proxy IPs/domains. Separate multiple with a comma.</p>
            <code>cdn.cloudflare.com:8443,104.16.132.229:443</code>

            <p><strong>SOCKS5</strong><br>Routes traffic through a SOCKS5 proxy (advanced).</p>
            <code>user:pass@1.2.3.4:1080</code>

            <p><strong>SCAMALYTICS_USERNAME</strong><br>Your username for the Scamalytics API service.</p>
            <code>your_username</code>

            <p><strong>SCAMALYTICS_API_KEY</strong><br>Your API key for the Scamalytics service.</p>
            <code>your_api_key_here</code>
        </div>
    </body>
    </html>
    `;
  return new Response(fallbackHtml, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * Handles all incoming WebSocket requests.
 * @param {Request} request The incoming request object.
 * @param {object} config The configuration object for this request.
 * @returns {Promise<Response>} A Response object with WebSocket handlers.
 */
async function handleWebSocketRequest(request, config) {
  const pair = new WebSocketPair();
  const [client, ws] = Object.values(pair);
  ws.accept();

  let remoteWrapper = { value: null };
  let isDns = false;
  let target = '';

  const log = (...args) => console.log('[WS]', ...args);
  const early = request.headers.get('sec-websocket-protocol') || '';

  const readable = MakeReadableWebSocketStream(ws, early, log);

  readable
    .pipeTo(
      new WritableStream({
        async write(chunk) {
          if (isDns) return;

          if (remoteWrapper.value) {
            const w = remoteWrapper.value.writable.getWriter();
            await w.write(chunk);
            w.releaseLock();
            return;
          }

          const parsed = ProcessProtocolHeader(chunk, config.userID);
          if (parsed.hasError) throw new Error(parsed.message);
          if (parsed.isUDP) throw new Error('UDP not supported');

          const { addressRemote, portRemote, addressType, rawDataIndex } = parsed;
          target = `${addressRemote}:${portRemote}`;
          const remain = chunk.slice(rawDataIndex);

          await HandleTCPOutBound(
            remoteWrapper,
            addressType,
            addressRemote,
            portRemote,
            remain,
            ws,
            log,
            config,
          );
        },
        close() {
          log('readable closed');
        },
        abort(r) {
          log('readable abort', r);
        },
      }),
    )
    .catch(e => {
      log('pipeTo err', e);
      safeCloseWebSocket(ws);
    });

  return new Response(null, { status: 101, webSocket: client });
}

/**
 * Creates a unified configuration object for a single request.
 * It merges defaults, environment variables, and URL parameters in a specific order of precedence:
 * URL Parameters > Environment Variables > Defaults.
 * @param {Request} request The incoming request object.
 * @param {object} env The environment variables.
 * @returns {object} A comprehensive configuration object.
 */

function createRequestConfig(request, env) {
  const url = new URL(request.url);
  const cfg = {
    userID: DEFAULT_USER_ID,
    proxyIPs: DEFAULT_PROXY_IPS,
    socks5Address: '',
    socks5Relay: false,
    scamalytics: {
      username: env.SCAMALYTICS_USERNAME ?? 'dianaclk01',
      apiKey:
        env.SCAMALYTICS_API_KEY ??
        'c57eb62bbde89f00742cb3f92d7127f96132c9cea460f18c08fd5e62530c5604',
      baseUrl: 'https://api11.scamalytics.com/v3/',
    },
    env,
    url,
    host: url.hostname,
  };

  if (env.UUID) cfg.userID = env.UUID;
  if (env.PROXYIP) cfg.proxyIPs = env.PROXYIP.split(',').map(x => x.trim());
  if (env.SOCKS5) cfg.socks5Address = env.SOCKS5;
  if (env.SOCKS5_RELAY) cfg.socks5Relay = env.SOCKS5_RELAY === 'true';

  const qs = url.searchParams;
  if (qs.get('proxyip'))
    cfg.proxyIPs = qs
      .get('proxyip')
      .split(',')
      .map(x => x.trim());
  if (qs.get('socks5')) cfg.socks5Address = qs.get('socks5');
  if (qs.get('socks5_relay')) cfg.socks5Relay = qs.get('socks5_relay') === 'true';

  if (!isValidUUID(cfg.userID.split(',')[0])) throw new Error('UUID format invalid');

  const selProxy = selectRandomAddress(cfg.proxyIPs);
  [cfg.proxyIP, cfg.proxyPort = '443'] = selProxy.split(':');
  cfg.enableSocks = !!cfg.socks5Address;
  if (cfg.enableSocks) cfg.parsedSocks5Address = socks5AddressParser(cfg.socks5Address);
  return cfg;
}

/**
 * Generates the beautiful configuration UI.
 * @param {string} userID - The user's UUID.
 * @param {string} hostName - The hostname of the worker.
 * @param {string} proxyIPWithPort - The selected proxy IP with port (e.g., '1.2.3.4:443').
 * @returns {string} The full HTML for the configuration page.
 */
function getBeautifulConfig(userID, hostName, proxyIPWithPort) {
  const vlessPath = `/?${CONSTANTS.URL_ED_PARAM}`;
  const dreamConfig = `vless://${userID}@${hostName}:443?encryption=none&security=tls&sni=${hostName}&fp=chrome&type=ws&host=${hostName}&path=${encodeURIComponent(vlessPath)}#${hostName}-Xray`;
  const freedomConfig = `vless://${userID}@${hostName}:443?encryption=none&security=tls&sni=${hostName}&fp=firefox&type=ws&host=${hostName}&path=${encodeURIComponent(vlessPath)}#${hostName}-Singbox`;

  const subUrl = `https://${hostName}/ipsub/${userID}`;
  const subUrlEncoded = encodeURIComponent(subUrl);
  const clashMetaFullUrl = `clash://install-config?url=https://revil-sub.pages.dev/sub/clash-meta?url=${subUrlEncoded}&remote_config=&udp=false&ss_uot=false&show_host=false&forced_ws0rtt=true`;

  let html = `
	<!doctype html>
	<html lang="en">
	<head>
	  <meta charset="UTF-8" />
	  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
	  <title>VLESS Proxy Configuration</title>
	  <link rel="preconnect" href="https://fonts.googleapis.com">
	  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	  <link href="https.googleapis.com/css2?family=Fira+Code:wght@300..700&display=swap" rel="stylesheet">
	  <style>
	    *
  	  *
      *
	</script>
	</body>
	</html>
	`;

  html = html
    .replace(/{{PROXY_IP}}/g, proxyIPWithPort)
    .replace(/{{DREAM_CONFIG}}/g, dreamConfig)
    .replace(/{{FREEDOM_CONFIG}}/g, freedomConfig)
    .replace(/{{CLASH_META_URL}}/g, clashMetaFullUrl)
    .replace(/{{SUB_URL_ENCODED}}/g, subUrlEncoded)
    .replace(/{{YEAR}}/g, new Date().getFullYear().toString());

  return html;
}

/**
 * Generates a standard subscription link with various domains and ports.
 * @param {string} userID_path The user ID(s).
 * @param {string} hostname The worker hostname.
 * @param {string[]} proxyIPArray Array of proxy IPs.
 * @returns {string} Base64 encoded subscription content.
 */
function GenSub(userID_path, hostname, proxyIPArray) {
  const mainDomains = new Set([
    hostname,
    'creativecommons.org',
    'sky.rethinkdns.com',
    'www.speedtest.net',
    'cfip.1323123.xyz',
    'cfip.xxxxxxxx.tk',
    'cf.090227.xyz',
    'go.inmobi.com',
    'cf.877771.xyz',
    'www.wto.org',
    'cdn.tzpro.xyz',
    'fbi.gov',
    'time.is',
    'zula.ir',
    'ip.sb',
    ...DEFAULT_PROXY_IPS,
  ]);

  const userIDArray = userID_path.includes(',') ? userID_path.split(',') : [userID_path];

  const randomPath = () => `/?${CONSTANTS.URL_ED_PARAM}`;
  const commonUrlPartHttp = `?encryption=none&security=none&fp=firefox&type=ws&host=${hostname}&path=${encodeURIComponent(randomPath())}#`;
  const commonUrlPartHttps = `?encryption=none&security=tls&sni=${hostname}&fp=chrome&type=ws&host=${hostname}&path=${encodeURIComponent(randomPath())}#`;

  const allUrls = [];

  userIDArray.forEach(userID => {
    if (!hostname.includes('pages.dev')) {
      mainDomains.forEach(domain => {
        CONSTANTS.HTTP_PORTS.forEach(port => {
          const urlPart = `${hostname.split('.')[0]}-${domain}-HTTP-${port}`;
          const mainProtocolHttp = `${CONSTANTS.VLESS_PROTOCOL}://${userID}${CONSTANTS.AT_SYMBOL}${domain}:${port}${commonUrlPartHttp}${urlPart}`;
          allUrls.push(mainProtocolHttp);
        });
      });
    }
    mainDomains.forEach(domain => {
      CONSTANTS.HTTPS_PORTS.forEach(port => {
        const urlPart = `${hostname.split('.')[0]}-${domain}-HTTPS-${port}`;
        const mainProtocolHttps = `${CONSTANTS.VLESS_PROTOCOL}://${userID}${CONSTANTS.AT_SYMBOL}${domain}:${port}${commonUrlPartHttps}${urlPart}`;
        allUrls.push(mainProtocolHttps);
      });
    });
    proxyIPArray.forEach(proxyAddr => {
      const [proxyHost, proxyPort = '443'] = proxyAddr.split(':');
      const urlPart = `${hostname.split('.')[0]}-${proxyHost}-HTTPS-${proxyPort}`;
      const secondaryProtocolHttps = `${CONSTANTS.VLESS_PROTOCOL}://${userID}${CONSTANTS.AT_SYMBOL}${proxyHost}:${proxyPort}${commonUrlPartHttps}${urlPart}-${CONSTANTS.CUSTOM_SUFFIX}`;
      allUrls.push(secondaryProtocolHttps);
    });
  });

  return btoa(allUrls.join('\n'));
}

/**
 * Generates a subscription link from a list of clean IPs.
 * @param {string} userID - The user's UUID.
 * @param {string} hostname - The hostname of the worker.
 * @param {string[]} ips - An array of IP addresses.
 * @returns {string} Base64 encoded subscription content.
 */
function GenIpSub(userID, hostname, ips) {
  const configs = [];
  const vlessPath = `/?${CONSTANTS.URL_ED_PARAM}`;
  const commonUrlPart = `?encryption=none&security=tls&sni=${hostname}&fp=chrome&type=ws&host=${hostname}&path=${encodeURIComponent(vlessPath)}#`;

  ips.forEach(ip => {
    const configName = `REvil-${ip}`;
    const vlessUrl = `${CONSTANTS.VLESS_PROTOCOL}://${userID}${CONSTANTS.AT_SYMBOL}${ip}:443${commonUrlPart}${encodeURIComponent(configName)}`;
    configs.push(vlessUrl);
  });

  return btoa(configs.join('\n'));
}

/**
 * Fetches clean IPs and generates a subscription response.
 * @param {string} matchingUserID The user ID.
 * @param {string} host The worker hostname.
 * @returns {Promise<Response>}
 */
async function generateIpSubscription(matchingUserID, host) {
  try {
    const response = await fetch(
      'https://raw.githubusercontent.com/NiREvil/vless/refs/heads/main/Cloudflare-IPs.json',
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch IPs: ${response.status}`);
    }
    const data = await response.json();
    const ips = [...(data.ipv4 || []), ...(data.ipv6 || [])].map(item => item.ip);

    if (ips.length === 0) {
      return new Response('No IPs found in the source.', { status: 404 });
    }

    const content = GenIpSub(matchingUserID, host, ips);
    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
  } catch (error) {
    console.error('Error in /ipsub endpoint:', error);
    return new Response(`Failed to generate IP subscription: ${error.message}`, { status: 500 });
  }
}

/**
 * Handles the TCP outbound connection for a WebSocket stream.
 * @param {{value: any}} remoteSocketWrapper - Wrapper object to hold the remote socket.
 * @param {number} addressType - The type of the address (1 for IPv4, 2 for domain, 3 for IPv6).
 * @param {string} addressRemote - The remote address.
 * @param {number} portRemote - The remote port.
 * @param {Uint8Array} rawClientData - The initial data from the client.
 * @param {WebSocket} webSocket - The client's WebSocket.
 * @param {function} log - The logging function.
 * @param {object} config - The request configuration object.
 */

async function HandleTCPOutBound(
  remoteSocketWrapper,
  addressType,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  log,
  config,
  protocolResponseHeader = null, // optional: default to null if not provided
) {
  async function connectAndWrite(address, port, useSocks = false) {
    log(`Attempting to connect to ${address}:${port}` + (useSocks ? ' via SOCKS5' : ''));

    const connectOptions = {
      hostname: address,
      port: port,
    };

    if (port === 443) {
      connectOptions.secureTransport = 'on';
    }

    const tcpSocket = useSocks
      ? await socks5Connect(addressType, address, port, log, config.parsedSocks5Address)
      : connect(connectOptions);

    remoteSocketWrapper.value = tcpSocket;
    log(`Connected to ${address}:${port}`);

    const writer = tcpSocket.writable.getWriter();
    await writer.write(rawClientData);
    writer.releaseLock();
    return tcpSocket;
  }

  try {
    let tcpSocket;
    // If SOCKS5 is enabled, all traffic goes through it.
    if (config.enableSocks) {
      tcpSocket = await connectAndWrite(addressRemote, portRemote, true);
    } else {
      // Otherwise, connect directly or through the proxyIP.
      const isCloudflareIP = await isCloudflare(addressRemote);
      if (isCloudflareIP) {
        tcpSocket = await connectAndWrite(addressRemote, portRemote, false);
      } else {
        tcpSocket = await connectAndWrite(config.proxyIP, config.proxyPort, false);
      }
    }

    if (tcpSocket) {
      RemoteSocketToWS(tcpSocket, webSocket, protocolResponseHeader, log);
    } else {
      throw new Error('Failed to establish TCP socket.');
    }
  } catch (error) {
    log(`HandleTCPOutBound error: ${error.message}`);
    safeCloseWebSocket(webSocket);
  }
}

/**
 * Processes the initial VLESS protocol header from the client.
 * @param {ArrayBuffer} protocolBuffer - The incoming data chunk.
 * @param {string} configuredUserID - The configured UUID(s) for the worker.
 * @returns {object} Parsed protocol information or an error.
 */

function ProcessProtocolHeader(buffer, configuredIDs) {
  if (buffer.byteLength < 24) return { hasError: true, message: 'buffer too short' };
  const dv = new DataView(buffer);
  const off = CONSTANTS.PROTOCOL_OFFSETS;

  const ver = dv.getUint8(off.VERSION);
  if (ver !== 1) return { hasError: true, message: 'Unsupported VLESS ver' };

  const recvUUID = stringify(new Uint8Array(buffer.slice(off.UUID, off.UUID + 16)));

  const allowed = configuredIDs.split(',').map(s => s.trim().toLowerCase());
  if (!allowed.includes(recvUUID.toLowerCase()))
    return { hasError: true, message: `Invalid user ${recvUUID}` };

  const optLen = dv.getUint8(off.OPT_LENGTH);
  const cmd = dv.getUint8(off.COMMAND + optLen);
  const port = dv.getUint16(off.COMMAND + optLen + 1);
  const aType = dv.getUint8(off.COMMAND + optLen + 3);
  const addrIdx = off.COMMAND + optLen + 4;

  let addr = '',
    aLen = 0;
  switch (aType) {
    case 1:
      aLen = 4;
      addr = Array.from(new Uint8Array(buffer.slice(addrIdx, addrIdx + 4))).join('.');
      break;
    case 2:
      aLen = dv.getUint8(addrIdx - 1);
      addr = new TextDecoder().decode(buffer.slice(addrIdx, addrIdx + aLen));
      break;
    case 3:
      aLen = 16;
      addr = [...new Uint16Array(buffer.slice(addrIdx, addrIdx + 16))]
        .map(x => x.toString(16).padStart(4, '0'))
        .join(':');
      break;
    default:
      return { hasError: true, message: `Bad ATYP ${aType}` };
  }

  return {
    hasError: false,
    addressRemote: addr,
    portRemote: port,
    addressType: aType,
    rawDataIndex: addrIdx + aLen,
    isUDP: cmd === 2,
  };
}

/**
 * Pipes data from a remote TCP socket to the client's WebSocket.
 * @param {any} remoteSocket - The remote TCP socket.
 * @param {WebSocket} webSocket - The client's WebSocket.
 * @param {function} log - Logging function.
 */
async function RemoteSocketToWS(remoteSocket, webSocket, protocolResponseHeader, log) {
  // Create a new AbortController for this connection
  const abortController = new AbortController();
  const { signal } = abortController;

  try {
    await remoteSocket.readable.pipeTo(
      new WritableStream({
        async write(chunk) {
          if (webSocket.readyState === CONSTANTS.WS_READY_STATE_OPEN) {
            // Prepend the protocol response header if it exists
            if (protocolResponseHeader) {
              const newChunk = new Uint8Array(protocolResponseHeader.length + chunk.length);
              newChunk.set(protocolResponseHeader);
              newChunk.set(chunk, protocolResponseHeader.length);
              webSocket.send(newChunk);
              protocolResponseHeader = null;
            } else {
              webSocket.send(chunk);
            }
          } else {
            // If the WebSocket is not open, abort the stream
            abortController.abort();
            throw new Error('WebSocket is not open, aborting pipe.');
          }
        },
        close() {
          log(`Remote connection readable is closed.`);
        },
        abort(reason) {
          console.error(`Remote connection readable aborted:`, reason);
        },
      }),
      { signal },
    );
  } catch (error) {
    if (signal.aborted) {
      log('Pipe aborted intentionally.');
    } else {
      console.error(`RemoteSocketToWS error:`, error.stack || error);
    }
  } finally {
    safeCloseWebSocket(webSocket);
  }
}

/**
 * Creates a ReadableStream from a WebSocket connection.
 * @param {WebSocket} webSocketServer The WebSocket instance.
 * @param {string} earlyDataHeader The early data header from the request.
 * @param {function} log Logging function.
 * @returns {ReadableStream}
 */
function MakeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  return new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener('message', event => {
        try {
          // Normalize incoming data: if it's a string, convert to Uint8Array; if it's Blob use .arrayBuffer()
          const data = event.data;
          if (typeof data === 'string') {
            controller.enqueue(new TextEncoder().encode(data).buffer);
          } else if (data instanceof ArrayBuffer) {
            controller.enqueue(data);
          } else if (data && typeof data.arrayBuffer === 'function') {
            // e.g., Blob - convert to ArrayBuffer asynchronously
            data.arrayBuffer().then(buf => controller.enqueue(buf)).catch(err => controller.error(err));
          } else {
            // Fallback: enqueue as-is (may still fail later if unexpected)
            controller.enqueue(data);
          }
        } catch (err) {
          controller.error(err);
        }
      });
      webSocketServer.addEventListener('close', () => {
        controller.close();
      });
      webSocketServer.addEventListener('error', err => {
        log('WebSocket error', err);
        controller.error(err);
      });
      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) {
        controller.error(error);
      } else if (earlyData) {
        controller.enqueue(earlyData);
      }
    },
    cancel(reason) {
      log(`ReadableStream was canceled, reason: ${reason}`);
      safeCloseWebSocket(webSocketServer);
    },
  });
}

/**
 * Fetches data from the Scamalytics API.
 * @param {string} ipToLookup The IP to check.
 * @param {object} scamalyticsConfig The Scamalytics configuration.
 * @returns {Promise<Response>}
 */
async function fetchScamalyticsData(ipToLookup, scamalyticsConfig) {
  const { username, apiKey, baseUrl } = scamalyticsConfig;
  if (!username || !apiKey) {
    console.error('Scamalytics credentials not configured.');
    return new Response('Scamalytics API credentials not configured on server.', { status: 500 });
  }

  const scamalyticsUrl = `${baseUrl}${username}/?key=${apiKey}&ip=${ipToLookup}`;

  try {
    const scamalyticsResponse = await fetch(scamalyticsUrl);
    const responseBody = await scamalyticsResponse.json();
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    return new Response(JSON.stringify(responseBody), {
      status: scamalyticsResponse.status,
      headers: headers,
    });
  } catch (apiError) {
    console.error('Error fetching from Scamalytics API:', apiError);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch from Scamalytics API', details: apiError.message }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      },
    );
  }
}

// Functions like isValidUUID, safeCloseWebSocket, stringify, etc.
// They are omitted for brevity in this response but are required for the script to work.

function stringify(arr, offset = 0) {
  const b2h = i => (i + 0x100).toString(16).slice(1);
  const uuid = [
    b2h(arr[offset]),
    b2h(arr[offset + 1]),
    b2h(arr[offset + 2]),
    b2h(arr[offset + 3]),
    '-',
    b2h(arr[offset + 4]),
    b2h(arr[offset + 5]),
    '-',
    b2h(arr[offset + 6]),
    b2h(arr[offset + 7]),
    '-',
    b2h(arr[offset + 8]),
    b2h(arr[offset + 9]),
    '-',
    b2h(arr[offset + 10]),
    b2h(arr[offset + 11]),
    b2h(arr[offset + 12]),
    b2h(arr[offset + 13]),
    b2h(arr[offset + 14]),
    b2h(arr[offset + 15]),
  ].join('');
  return uuid.toLowerCase();
}
function isValidUUID(u) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(u);
}
function safeCloseWebSocket(s) {
  try {
    if (s.readyState === 1 || s.readyState === 2) s.close();
  } catch {}
}
function selectRandomAddress(a) {
  const arr = typeof a === 'string' ? a.split(',').map(s => s.trim()) : a;
  return arr[Math.floor(Math.random() * arr.length)];
}

function base64ToArrayBuffer(base64Str) {
  if (!base64Str) {
    return { earlyData: null, error: null };
  }
  try {
    const binaryStr = atob(base64Str.replace(/-/g, '+').replace(/_/g, '/'));
    const buffer = new ArrayBuffer(binaryStr.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binaryStr.length; i++) {
      view[i] = binaryStr.charCodeAt(i);
    }
    return { earlyData: buffer, error: null };
  } catch (error) {
    return { earlyData: null, error };
  }
}

function findMatchingUserID(pathname, configuredUserIDs) {
  const userIDs = configuredUserIDs.split(',').map(id => id.trim());
  const requestedPath = pathname.substring(1);

  return userIDs.find(id => {
    return (
      requestedPath.startsWith(id) ||
      requestedPath.startsWith(`sub/${id}`) ||
      requestedPath.startsWith(`ipsub/${id}`)
    );
  });
}

async function isCloudflare(domain) {
  try {
    const response = await fetch(
      `https://1.1.1.1/dns-query?name=${encodeURIComponent(domain)}&type=A`,
      {
        headers: { accept: 'application/dns-json' },
      },
    );
    if (!response.ok) return false;
    const data = await response.json();
    // A simple check could be to see if the authoritative name server includes 'cloudflare'.
    // This is not foolproof but works for many cases.
    return data?.Authority?.some(auth => auth.data.includes('cloudflare.com'));
  } catch {
    return false;
  }
}

function socks5AddressParser(address) {
  let [latter, former] = address.split('@').reverse();
  let username, password, hostname, port;
  if (former) {
    const formers = former.split(':');
    if (formers.length !== 2) throw new Error('Invalid SOCKS address format');
    [username, password] = formers;
  }
  const latters = latter.split(':');
  port = Number(latters.pop());
  if (isNaN(port)) throw new Error('Invalid SOCKS address format');
  hostname = latters.join(':');
  if (hostname.includes(':') && !/^\[.*\]$/.test(hostname)) {
    throw new Error('Invalid SOCKS address format for IPv6');
  }
  return { username, password, hostname, port };
}

async function socks5Connect(addressType, addressRemote, portRemote, log, parsedSocks5Addr) {
  const { username, password, hostname, port } = parsedSocks5Addr;
  const socket = connect({ hostname, port });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  await writer.write(new Uint8Array([5, 1, 0]));
  let res = (await reader.read()).value;
  if (res[0] !== 0x05 || res[1] !== 0x00) {
    throw new Error('SOCKS5 greeting failed');
  }

  const encoder = new TextEncoder();
  let DSTADDR;
  switch (addressType) {
    case 1:
      DSTADDR = new Uint8Array([1, ...addressRemote.split('.').map(Number)]);
      break;
    case 2:
      DSTADDR = new Uint8Array([3, addressRemote.length, ...encoder.encode(addressRemote)]);
      break;
    case 3:
      DSTADDR = new Uint8Array([
        4,
        ...addressRemote
          .split(':')
          .flatMap(x => [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2), 16)]),
      ]);
      break;
    default:
      throw new Error(`Invalid addressType: ${addressType}`);
  }

  const request = new Uint8Array([5, 1, 0, ...DSTADDR, portRemote >> 8, portRemote & 0xff]);
  await writer.write(request);
  res = (await reader.read()).value;
  if (res[1] !== 0x00) {
    throw new Error(`SOCKS5 connection failed with code: ${res[1]}`);
  }

  writer.releaseLock();
  reader.releaseLock();
  return socket;
}
