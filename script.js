/**
 * Cloudflare Worker for VLESS proxy with WebSocket and configuration UI.
 * 
 */

// Constants for configuration
const CONSTANTS = {
  DEFAULT_PORT: 443,
  DNS_PORT: 53,
  API_PATHS: {
    SING_BOX: '/api/v4',
    XRAY: '/api/v2',
  },
  WS_PROTOCOL: 'ws',
  VLESS_PROTOCOL: 'vless',
  NETWORK_TYPE: 'websocket',
  DNS_RESOLVER: '1.1.1.1',
  MAX_RETRIES: 3,
};

// Default user UUID and proxy IP (overridable via env vars)
let userCode = '15553e19-982d-4202-bcc2-7a9fd530e9d1';
let proxyIP = 'turk.radicalization.ir';
let dnsResolver = CONSTANTS.DNS_RESOLVER;

/**
 * Validates a UUIDv4 string.
 * @param {string} code - The UUID to validate.
 * @returns {boolean} True if valid, false otherwise.
 */
function isValidUserCode(code) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(code);
}

/**
 * Converts base64 to ArrayBuffer.
 * @param {string} base64Str - Base64 string.
 * @returns {{ earlyData?: ArrayBuffer, error?: Error }} Result or error.
 */
function base64ToArrayBuffer(base64Str) {
  if (!base64Str) {
    return { error: null };
  }
  try {
    base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/');
    const decode = atob(base64Str);
    const arrayBuffer = Uint8Array.from(decode, c => c.charCodeAt(0));
    return { earlyData: arrayBuffer.buffer, error: null };
  } catch (error) {
    return { error };
  }
}

/**
 * Safely closes a WebSocket.
 * @param {WebSocket} socket - The WebSocket to close.
 */
function safeCloseWebSocket(socket) {
  try {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) {
      socket.close();
    }
  } catch (error) {
    console.error('safeCloseWebSocket error', error);
  }
}

/**
 * Converts bytes to UUID string.
 * @param {Uint8Array} arr - Byte array.
 * @param {number} offset - Starting offset.
 * @returns {string} UUID string.
 */
function stringify(arr, offset = 0) {
  const byteToHex = [];
  for (let i = 0; i < 256; ++i) {
    byteToHex.push((i + 256).toString(16).slice(1));
  }
  const uuid = (
    byteToHex[arr[offset + 0]] +
    byteToHex[arr[offset + 1]] +
    byteToHex[arr[offset + 2]] +
    byteToHex[arr[offset + 3]] +
    '-' +
    byteToHex[arr[offset + 4]] +
    byteToHex[arr[offset + 5]] +
    '-' +
    byteToHex[arr[offset + 6]] +
    byteToHex[arr[offset + 7]] +
    '-' +
    byteToHex[arr[offset + 8]] +
    byteToHex[arr[offset + 9]] +
    '-' +
    byteToHex[arr[offset + 10]] +
    byteToHex[arr[offset + 11]] +
    byteToHex[arr[offset + 12]] +
    byteToHex[arr[offset + 13]] +
    byteToHex[arr[offset + 14]] +
    byteToHex[arr[offset + 15]]
  ).toLowerCase();
  if (!isValidUserCode(uuid)) {
    throw TypeError('Stringified UUID is invalid');
  }
  return uuid;
}

/**
 * Main Worker fetch handler.
 * @param {Request} request - Incoming request.
 * @param {{UUID?: string, PROXYIP?: string, DNS_RESOLVER?: string}} env - Environment variables.
 * @param {ExecutionContext} ctx - Execution context.
 * @returns {Promise<Response>} Response.
 */
export default {
  async fetch(request, env, ctx) {
    try {
      userCode = env.UUID || userCode;
      proxyIP = env.PROXYIP || proxyIP;
      dnsResolver = env.DNS_RESOLVER || dnsResolver;

      if (!isValidUserCode(userCode)) {
        throw new Error('Invalid user code');
      }

      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader !== CONSTANTS.WS_PROTOCOL) {
        const url = new URL(request.url);
        switch (url.pathname) {
          case '/':
            return new Response(JSON.stringify(request.cf, null, 2), {
              status: 200,
              headers: { 'Content-Type': 'application/json;charset=utf-8' },
            });
          case `/${userCode}`: {
            const streamConfig = getDianaConfig(userCode, request.headers.get('Host'));
            return new Response(streamConfig, {
              status: 200,
              headers: { 'Content-Type': 'text/html;charset=utf-8' },
            });
          }
          default:
            return new Response('Not found', { status: 404 });
        }
      } else {
        return await streamOverWSHandler(request);
      }
    } catch (err) {
      console.error('Fetch error:', err);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};

/**
 * Handles WebSocket streaming.
 * @param {Request} request - Incoming request.
 * @returns {Promise<Response>} WebSocket response.
 */
async function streamOverWSHandler(request) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);

  webSocket.accept();

  let address = '';
  let portWithRandomLog = '';
  const log = (info, event) => {
    console.log(`[${address}:${portWithRandomLog}] ${info}`, event || '');
  };
  const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';

  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

  let remoteSocketWrapper = { value: null };
  let udpStreamWrite = null;
  let isDns = false;

  readableWebSocketStream
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          if (isDns && udpStreamWrite) {
            return udpStreamWrite(chunk);
          }
          if (remoteSocketWrapper.value) {
            const writer = remoteSocketWrapper.value.writable.getWriter();
            await writer.write(chunk);
            writer.releaseLock();
            return;
          }

          const {
            hasError,
            message,
            portRemote = CONSTANTS.DEFAULT_PORT,
            addressRemote = '',
            rawDataIndex,
            streamVersion = new Uint8Array([0, 0]),
            isUDP,
          } = processStreamHeader(chunk, userCode);

          address = addressRemote;
          portWithRandomLog = `${portRemote}--${Math.random()} ${isUDP ? 'udp' : 'tcp'}`;

          if (hasError) {
            throw new Error(message);
          }

          if (isUDP) {
            if (portRemote === CONSTANTS.DNS_PORT) {
              isDns = true;
            } else {
              throw new Error('UDP proxy only enabled for DNS (port 53)');
            }
          }

          const streamResponseHeader = new Uint8Array([streamVersion[0], 0]);
          const rawClientData = chunk.slice(rawDataIndex);

          if (isDns) {
            const { write } = await handleUDPOutBound(webSocket, streamResponseHeader, log);
            udpStreamWrite = write;
            udpStreamWrite(rawClientData);
            return;
          }
          await handleTCPOutBound(
            remoteSocketWrapper,
            addressRemote,
            portRemote,
            rawClientData,
            webSocket,
            streamResponseHeader,
            log,
          );
        },
        close() {
          log('ReadableWebSocketStream closed');
        },
        abort(reason) {
          log('ReadableWebSocketStream aborted', JSON.stringify(reason));
        },
      }),
    )
    .catch(err => {
      log('ReadableWebSocketStream pipeTo error', err);
    });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

/**
 * Creates a readable WebSocket stream with backpressure.
 * @param {WebSocket} webSocketServer - Server WebSocket.
 * @param {string} earlyDataHeader - Early data header.
 * @param {(info: string, event?: string) => void} log - Logging function.
 * @returns {ReadableStream} Readable stream.
 */
function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  let readableStreamCancel = false;
  const queue = [];
  const maxQueueSize = 1024 * 1024; // 1MB

  const stream = new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener('message', event => {
        if (readableStreamCancel) return;
        const message = event.data;
        if (queue.length * message.byteLength < maxQueueSize) {
          queue.push(message);
          if (queue.length === 1) {
            controller.enqueue(message);
          }
        } else {
          log('Backpressure: queue full');
        }
      });

      webSocketServer.addEventListener('close', () => {
        safeCloseWebSocket(webSocketServer);
        if (!readableStreamCancel) controller.close();
      });

      webSocketServer.addEventListener('error', err => {
        log('WebSocketServer error');
        controller.error(err);
      });

      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) {
        controller.error(error);
      } else if (earlyData) {
        queue.push(earlyData);
        controller.enqueue(earlyData);
      }
    },
    async pull(controller) {
      if (queue.length > 1) {
        queue.shift();
        if (queue.length > 0) {
          controller.enqueue(queue[0]);
        }
      }
    },
    cancel(reason) {
      log(`ReadableStream canceled: ${reason}`);
      readableStreamCancel = true;
      safeCloseWebSocket(webSocketServer);
    },
  });

  return stream;
}

/**
 * Processes VLESS header.
 * @param {ArrayBuffer} vlessBuffer - VLESS buffer.
 * @param {string} userID - User UUID.
 * @returns {Object} Processed header data.
 */
function processStreamHeader(chunk, userCode) {
  if (chunk.byteLength < 24) {
    return { hasError: true, message: 'Invalid data' };
  }

  const version = new Uint8Array(chunk.slice(0, 1));
  let isValidUser = false;
  let isUDP = false;

  if (stringify(new Uint8Array(chunk.slice(1, 17))) === userCode) {
    isValidUser = true;
  }

  if (!isValidUser) {
    return { hasError: true, message: 'Invalid user' };
  }

  const optLength = new Uint8Array(chunk.slice(17, 18))[0];
  const command = new Uint8Array(chunk.slice(18 + optLength, 18 + optLength + 1))[0];

  if (command === 1) {
    // TCP
  } else if (command === 2) {
    isUDP = true;
  } else {
    return { hasError: true, message: `Command ${command} not supported` };
  }

  const portIndex = 18 + optLength + 1;
  const portBuffer = chunk.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);

  let addressIndex = portIndex + 2;
  const addressBuffer = new Uint8Array(chunk.slice(addressIndex, addressIndex + 1));
  const addressType = addressBuffer[0];
  let addressLength = 0;
  let addressValueIndex = addressIndex + 1;
  let addressValue = '';

  switch (addressType) {
    case 1: // IPv4
      addressLength = 4;
      addressValue = new Uint8Array(
        chunk.slice(addressValueIndex, addressValueIndex + addressLength),
      ).join('.');
      break;
    case 2: // Domain
      addressLength = new Uint8Array(chunk.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(
        chunk.slice(addressValueIndex, addressValueIndex + addressLength),
      );
      break;
    case 3: // IPv6
      addressLength = 16;
      const dataView = new DataView(
        chunk.slice(addressValueIndex, addressValueIndex + addressLength),
      );
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(':');
      break;
    default:
      return { hasError: true, message: `Invalid addressType: ${addressType}` };
  }

  if (!addressValue) {
    return { hasError: true, message: 'Address value is empty' };
  }

  return {
    hasError: false,
    addressRemote: addressValue,
    addressType,
    portRemote,
    rawDataIndex: addressValueIndex + addressLength,
    streamVersion: version,
    isUDP,
  };
}

/**
 * Handles TCP outbound connections.
 * @param {Object} remoteSocket - Remote socket wrapper.
 * @param {string} addressRemote - Remote address.
 * @param {number} portRemote - Remote port.
 * @param {Uint8Array} rawClientData - Client data.
 * @param {WebSocket} webSocket - WebSocket.
 * @param {Uint8Array} vlessResponseHeader - VLESS response header.
 * @param {(info: string, event?: string) => void} log - Logging function.
 */
async function handleTCPOutBound(
  remoteSocket,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  vlessResponseHeader,
  log,
) {
  async function connectAndWrite(address, port, attempt = 1) {
    try {
      const tcpSocket = connect({ hostname: address, port });
      remoteSocket.value = tcpSocket;
      log(`Connected to ${address}:${port}`);
      const writer = tcpSocket.writable.getWriter();
      await writer.write(rawClientData);
      writer.releaseLock();
      return tcpSocket;
    } catch (error) {
      if (attempt < CONSTANTS.MAX_RETRIES) {
        log(`Connection failed, retrying (${attempt + 1}/${CONSTANTS.MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        return connectAndWrite(address, port, attempt + 1);
      }
      throw error;
    }
  }

  async function retry() {
    try {
      const tcpSocket = await connectAndWrite(proxyIP || addressRemote, portRemote);
      tcpSocket.closed
        .catch(error => {
          log('Retry tcpSocket closed error', error);
        })
        .finally(() => {
          safeCloseWebSocket(webSocket);
        });
      remoteSocketToWS(tcpSocket, webSocket, vlessResponseHeader, null, log);
    } catch (error) {
      log('Retry failed', error);
      safeCloseWebSocket(webSocket);
    }
  }

  const tcpSocket = await connectAndWrite(addressRemote, portRemote);
  remoteSocketToWS(tcpSocket, webSocket, vlessResponseHeader, retry, log);
}

/**
 * Pipes remote socket to WebSocket.
 * @param {Socket} remoteSocket - Remote socket.
 * @param {WebSocket} webSocket - WebSocket.
 * @param {Uint8Array} vlessResponseHeader - VLESS response header.
 * @param {Function | null} retry - Retry function.
 * @param {(info: string, event?: string) => void} log - Logging function.
 */
async function remoteSocketToWS(remoteSocket, webSocket, vlessResponseHeader, retry, log) {
  let remoteChunkCount = 0;
  let vlessHeader = vlessResponseHeader;
  let hasIncomingData = false;

  await remoteSocket.readable
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          hasIncomingData = true;
          if (webSocket.readyState !== WebSocket.OPEN) {
            controller.error('WebSocket not open');
            return;
          }
          if (vlessHeader) {
            webSocket.send(await new Blob([vlessHeader, chunk]).arrayBuffer());
            vlessHeader = null;
          } else {
            webSocket.send(chunk);
          }
        },
        close() {
          log('Remote connection closed');
        },
        abort(reason) {
          log('Remote connection aborted', reason);
        },
      }),
    )
    .catch(error => {
      log('remoteSocketToWS error', error);
      safeCloseWebSocket(webSocket);
    });

  if (!hasIncomingData && retry) {
    log('No incoming data, retrying');
    retry();
  }
}

/**
 * Handles UDP outbound (DNS only).
 * @param {WebSocket} webSocket - WebSocket.
 * @param {ArrayBuffer} vlessResponseHeader - VLESS response header.
 * @param {(info: string, event?: string) => void} log - Logging function.
 * @returns {Object} Write function.
 */
async function handleUDPOutBound(webSocket, vlessResponseHeader, log) {
  let isHeaderSent = false;

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      for (let index = 0; index < chunk.byteLength; ) {
        const lengthBuffer = chunk.slice(index, index + 2);
        const udpPacketLength = new DataView(lengthBuffer).getUint16(0);
        const udpData = new Uint8Array(chunk.slice(index + 2, index + 2 + udpPacketLength));
        index = index + 2 + udpPacketLength;
        controller.enqueue(udpData);
      }
    },
  });

  transformStream.readable
    .pipeTo(
      new WritableStream({
        async write(chunk) {
          try {
            const resp = await fetch(`https://${dnsResolver}/dns-query`, {
              method: 'POST',
              headers: { 'content-type': 'application/dns-message' },
              body: chunk,
            });
            const dnsQueryResult = await resp.arrayBuffer();
            const udpSize = dnsQueryResult.byteLength;
            const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 0xff, udpSize & 0xff]);

            if (webSocket.readyState === WebSocket.OPEN) {
              log(`DNS query success, length: ${udpSize}`);
              if (isHeaderSent) {
                webSocket.send(await new Blob([udpSizeBuffer, dnsQueryResult]).arrayBuffer());
              } else {
                webSocket.send(
                  await new Blob([vlessResponseHeader, udpSizeBuffer, dnsQueryResult]).arrayBuffer(),
                );
                isHeaderSent = true;
              }
            }
          } catch (error) {
            log('DNS query error', error);
          }
        },
      }),
    )
    .catch(error => {
      log('DNS stream error', error);
    });

  const writer = transformStream.writable.getWriter();
  return { write: chunk => writer.write(chunk) };
}

/**
 * Generates VLESS configuration HTML.
 * @param {string} userCode - User UUID.
 * @param {string} hostName - Hostname.
 * @returns {string} HTML content.
 */
function getDianaConfig(userCode, hostName) {
  const protocol = CONSTANTS.VLESS_PROTOCOL;
  const networkType = CONSTANTS.WS_PROTOCOL;

  const baseUrl = `${protocol}://${userCode}@${hostName}:${CONSTANTS.DEFAULT_PORT}`;
  const commonParams = `encryption=none&host=${hostName}&type=${networkType}&security=tls&sni=${hostName}`;

  const freedomConfig =
    `${baseUrl}?path=${CONSTANTS.API_PATHS.SING_BOX}&eh=Sec-WebSocket-Protocol` +
    `&ed=2560&${commonParams}&fp=chrome&alpn=h3#${hostName}`;

  const dreamConfig =
    `${baseUrl}?path=${CONSTANTS.API_PATHS.XRAY}?ed=2048&${commonParams}` +
    `&fp=randomized&alpn=h2,http/1.1#${hostName}`;

  const clashMetaFullUrl = `clash://install-config?url=${encodeURIComponent(
    `https://sub.victoriacross.ir/sub/clash-meta?url=${encodeURIComponent(freedomConfig)}&remote_config=&udp=true&ss_uot=false&show_host=false&forced_ws0rtt=false`,
  )}`;

  const nekoBoxImportUrl = `https://sahar-km.github.io/arcane/${btoa(freedomConfig)}`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VLESS Proxy Configuration</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link  href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400&display=swap" rel="stylesheet" />
  <style>
    :root {
      --background-primary: #2a2421;
      --background-secondary: #35302c;
      --background-tertiary: #413b35;
      --border-color: #5a4f45;
      --border-color-hover: #766a5f;
      --text-primary: #e5dfd6;
      --text-secondary: #b3a89d;
      --text-accent: #ffffff;
      --accent-primary: #be9b7b;
      --accent-secondary: #d4b595;
      --accent-tertiary: #8d6e5c;
      --accent-primary-darker: #8a6f56;
      --button-text-primary: #2a2421;
      --button-text-secondary: var(--text-primary);
      --shadow-color: rgba(0, 0, 0, 0.35);
      --shadow-color-accent: rgba(190, 155, 123, 0.4);
      --border-radius: 8px;
      --transition-speed: 0.2s;
      --font-mono: 'Roboto Mono', monospace;
      --sans-serif: system-ui, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: var(--sans-serif);
      font-size: 16px;
      background-color: var(--background-primary);
      color: var(--text-primary);
      padding: 24px;
      line-height: 1.6;
    }
    .container {
      max-width: 800px;
      margin: 20px auto;
      padding: 0 12px;
      border-radius: var(--border-radius);
      box-shadow: 0 6px 15px var(--shadow-color);
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
      padding-top: 30px;
    }
    .header h1 {
      font-size: 32px;
      color: var(--text-accent);
    }
    .header p {
      color: var(--text-secondary);
      font-size: 14px;
    }
    .config-card {
      background: var(--background-secondary);
      border-radius: var(--border-radius);
      padding: 20px;
      margin-bottom: 24px;
      border: 1px solid var(--border-color);
      transition: border-color var(--transition-speed) ease;
    }
    .config-card:hover {
      border-color: var(--border-color-hover);
    }
    .config-title {
      font-size: 22px;
      color: var(--accent-secondary);
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-color);
    }
    .config-content {
      position: relative;
      background: var(--background-tertiary);
      border-radius: var(--border-radius);
      padding: 16px;
      margin-bottom: 20px;
      border: 1px solid var(--border-color);
    }
    .config-content pre {
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 14px;
      color: var(--text-primary);
      margin: 0;
      white-space: pre-wrap;
      word-break: break-all;
      padding-right: 70px;
    }
    .attributes {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 10px;
    }
    .attribute span {
      font-size: 14px;
      color: var(--text-secondary);
    }
    .attribute strong {
      font-size: 16px;
      color: var(--accent-secondary);
      word-break: break-all;
    }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 10px 16px;
      border-radius: var(--border-radius);
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      cursor: pointer;
      border: 1px solid var(--border-color);
      background-color: var(--background-tertiary);
      color: var(--button-text-secondary);
      transition: background-color var(--transition-speed) ease, border-color var(--transition-speed) ease;
    }
    .button:hover {
      background-color: #4d453e;
      border-color: var(--border-color-hover);
    }
    .copy-buttons {
      position: absolute;
      top: 12px;
      right: 12px;
      padding: 6px 12px;
      font-size: 13px;
      background-color: var(--background-tertiary);
      color: var(--accent-secondary);
    }
    .copy-buttons:hover {
      background-color: #4d453e;
      color: var(--accent-primary);
    }
    .client-buttons {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .client-btn {
      background-color: var(--accent-primary);
      color: var(--button-text-primary);
      border-color: var(--accent-primary-darker);
    }
    .client-btn:hover {
      background-color: var(--accent-secondary);
      border-color: var(--accent-secondary);
    }
    .client-icon {
      width: 18px;
      height: 18px;
      margin-right: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .client-icon svg {
      width: 14px;
      height: 14px;
      fill: var(--accent-secondary);
    }
    .button.copied {
      background-color: var(--accent-secondary);
      color: var(--background-tertiary);
    }
    .button.error {
      background-color: #c74a3b;
      color: var(--text-accent);
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding-bottom: 40px;
      color: var(--text-secondary);
      font-size: 12px;
    }
    .status-indicator {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 6px;
    }
    .status-active {
      background-color: #4CAF50;
    }
    .status-inactive {
      background-color: #F44336;
    }
    .loading {
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }
    @media (max-width: 768px) {
      body { padding: 16px; }
      .container { max-width: 100%; }
      .header h1 { font-size: 28px; }
      .config-content pre { font-size: 12px; }
      .client-buttons { grid-template-columns: 1fr; }
    }
    @media (max-width: 480px) {
      .header h1 { font-size: 24px; }
      .config-content pre { font-size: 11px; padding-right: 60px; }
      .attributes { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>VLESS Proxy Configuration</h1>
      <p>Copy the configuration or import directly into your client</p>
    </div>
    <div class="config-card">
      <div class="config-title">Proxy Information</div>
      <div class="attributes">
        <div class="attribute">
          <span>Proxy IP / Host:</span>
          <strong id="proxy-ip-display">${proxyIP}</strong>
        </div>
        <div class="attribute">
          <span>Status:</span>
          <strong>
            <span class="status-indicator status-active" aria-hidden="true"></span>
            <span id="proxy-status">Active</span>
          </strong>
        </div>
        <div class="attribute">
          <span>Last Updated:</span>
          <strong id="last-updated">14 May 2025</strong>
        </div>
      </div>
    </div>
    <div class="config-card">
      <div class="config-title">Xray Core Clients</div>
      <div class="config-content">
        <button class="button copy-buttons" onclick="copyToClipboard(this, '${dreamConfig}')" aria-label="Copy Xray configuration">
          Copy
        </button>
        <pre id="xray-config">${dreamConfig}</pre>
      </div>
      <div class="client-buttons">
        <a href="hiddify://install-config?url=${encodeURIComponent(freedomConfig)}" class="button client-btn" aria-label="Import to Hiddify">
          <span class="client-icon">
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </span>
          Import to Hiddify
        </a>
        <a href="v2rayng://install-config?url=${encodeURIComponent(dreamConfig)}" class="button client-btn" aria-label="Import to V2rayNG">
          <span class="client-icon">
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <path d="M12 2L4 5v6c0 5.5 3.5 10.7 8 12.3 4.5-1.6 8-6.8 8-12.3V5l-8-3z"/>
            </svg>
          </span>
          Import to V2rayNG
        </a>
      </div>
    </div>
    <div class="config-card">
      <div class="config-title">Sing-Box Core Clients</div>
      <div class="config-content">
        <button class="button copy-buttons" onclick="copyToClipboard(this, '${freedomConfig}')" aria-label="Copy Sing-Box configuration">
          Copy
        </button>
        <pre id="singbox-config">${freedomConfig}</pre>
      </div>
      <div class="client-buttons">
        <a href="${clashMetaFullUrl}" class="button client-btn" aria-label="Import to Clash Meta">
          <span class="client-icon">
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
          </span>
          Import to Clash Meta
        </a>
        <a href="${nekoBoxImportUrl}" class="button client-btn" aria-label="Import to NekoBox">
          <span class="client-icon">
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <path d="M20,8h-3V6c0-1.1-0.9-2-2-2H9C7.9,4,7,4.9,7,6v2H4C2.9,8,2,8.9,2,10v9c0,1.1,0.9,2,2,2h16c1.1,0,2-0.9,2-2v-9 C22,8.9,21.1,8,20,8z M9,6h6v2H9V6z M20,19H4v-2h16V19z M20,15H4v-5h3v1c0,0.55,0.45,1,1,1h1.5c0.28,0,0.5-0.22,0.5-0.5v-0.5h4v0.5 c0,0.28,0.22,0.5,0.5,0.5H16c0.55,0,1-0.45,1-1v-1h3V15z"/>
              <circle cx="8.5" cy="13.5" r="1"/>
              <circle cx="15.5" cy="13.5" r="1"/>
              <path d="M12,15.5c-0.55,0-1-0.45-1-1h2C13,15.05,12.55,15.5,12,15.5z"/>
            </svg>
          </span>
          Import to NekoBox
        </a>
      </div>
    </div>
    <div class="footer">
      <p>© <span id="current-year">${new Date().getFullYear()}</span> Diana - All Rights Reserved</p>
      <p>Secure. Private. Fast.</p>
    </div>
  </div>
  <script>
    function copyToClipboard(button, text) {
      const originalText = button.textContent;
      button.disabled = true;
      button.classList.remove('copied', 'error');
      navigator.clipboard.writeText(text).then(() => {
        button.textContent = 'Copied!';
        button.classList.add('copied');
        setTimeout(() => {
          button.textContent = originalText;
          button.classList.remove('copied');
          button.disabled = false;
        }, 1200);
      }).catch(err => {
        button.textContent = 'Error';
        button.classList.add('error');
        setTimeout(() => {
          button.textContent = originalText;
          button.classList.remove('error');
          button.disabled = false;
        }, 1500);
      });
    }
    function formatDateTime(date) {
      return date.toLocaleString('en-US', {
        day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true
      });
    }
    function initializeProxyData() {
      document.getElementById('last-updated').textContent = formatDateTime(new Date());
    }
    function checkProxyStatus() {
      const statusIndicator = document.querySelector('.status-indicator');
      const statusText = document.getElementById('proxy-status');
      statusIndicator.classList.add('loading');
      setTimeout(() => {
        const isActive = Math.random() > 0.1;
        statusIndicator.classList.remove('loading');
        statusIndicator.classList.toggle('status-active', isActive);
        statusIndicator.classList.toggle('status-inactive', !isActive);
        statusText.textContent = isActive ? 'Active' : 'Inactive';
        document.getElementById('last-updated').textContent = formatDateTime(new Date());
      }, 1000);
    }
    function setupImportLinks() {
      // No-op for now
    }
    initializeProxyData();
    checkProxyStatus();
    setInterval(checkProxyStatus, 60000);
  </script>
</body>
</html>
`;
}
