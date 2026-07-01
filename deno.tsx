// =========================================================
// Deno Edge Service - VLESS Proxy with Admin Panel
// 后台地址： https://你的域名/<UUID>
// =========================================================

// 1. 你的专属 UUID
const userID = "f80d3ac0-4d45-493a-8b2d-cff5b6ee29da";

// 2. 后台路径：域名 + UUID
const ADMIN_PATH = `/${userID}`;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const expectedUUID = parseUUID(userID);
const VLESS_VERSION = 0;
const VLESS_COMMAND_TCP = 1;
const VLESS_HEADER_RESPONSE = new Uint8Array([VLESS_VERSION, 0]);
const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CONNECTING = 0;
const HTML_HEADERS = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
};

// 3. 伪装网页
const CAMOUFLAGE_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Gateway Status</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f3f4f6; color: #1f2937; }
        .card { background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); text-align: center; max-width: 400px; }
        .status-dot { display: inline-block; width: 12px; height: 12px; background-color: #10b981; border-radius: 50%; margin-right: 8px; box-shadow: 0 0 8px #10b981; }
        h1 { font-size: 1.5rem; margin-top: 0; color: #111827; display: flex; align-items: center; justify-content: center; }
        p { color: #4b5563; line-height: 1.5; margin-bottom: 1.5rem; }
        .footer { font-size: 0.875rem; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 1rem; }
    </style>
</head>
<body>
    <div class="card">
        <h1><span class="status-dot"></span> System Operational</h1>
        <p>The edge compute node and API gateway are actively routing requests. No anomalies detected in the current region.</p>
        <div class="footer">Response Code: 200 OK | Region: Global Edge</div>
    </div>
</body>
</html>
`;

function html(body: string, status = 200) {
    return new Response(body, {
        status,
        headers: HTML_HEADERS,
    });
}

function escapeHtml(str: string) {
    return str
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function parseUUID(uuid: string) {
    const hex = uuid.replaceAll("-", "");
    if (!/^[\da-f]{32}$/i.test(hex)) {
        throw new Error("Invalid UUID format");
    }

    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function isValidUUID(buffer: Uint8Array) {
    if (buffer.length < expectedUUID.length) return false;
    for (let i = 0; i < expectedUUID.length; i++) {
        if (buffer[i] !== expectedUUID[i]) return false;
    }
    return true;
}

function decodeBase64Url(value: string) {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function toUint8Array(data: string | ArrayBufferLike | Blob) {
    if (typeof data === "string") {
        return textEncoder.encode(data);
    }
    if (data instanceof Blob) {
        return new Uint8Array(await data.arrayBuffer());
    }
    return new Uint8Array(data);
}

function closeSocket(socket: WebSocket, code = 1008, reason = "Invalid request") {
    try {
        if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CONNECTING) {
            socket.close(code, reason);
        }
    } catch {
    }
}

type TargetConnection = {
    writer: WritableStreamDefaultWriter<Uint8Array>;
    conn: Deno.TcpConn;
};

function closeTarget(target: TargetConnection | null) {
    if (!target) return;
    void target.writer.close().catch(() => {});
    try {
        target.conn.close();
    } catch {
    }
}

function readIPv6(buffer: Uint8Array, start: number) {
    const ipv6Parts = [];
    for (let i = 0; i < 16; i += 2) {
        ipv6Parts.push(((buffer[start + i] << 8) | buffer[start + i + 1]).toString(16));
    }
    return ipv6Parts.join(":");
}

type VlessRequest = {
    targetAddress: string;
    targetPort: number;
    payload: Uint8Array;
};

type DashboardItem = {
    label: string;
    value: string;
    escape?: boolean;
};

function parseVlessRequest(buffer: Uint8Array): VlessRequest {
    if (buffer.length < 24) {
        throw new Error("VLESS request too short");
    }

    if (buffer[0] !== VLESS_VERSION) {
        throw new Error("Unsupported VLESS version");
    }

    if (!isValidUUID(buffer.subarray(1, 17))) {
        throw new Error("Invalid UUID");
    }

    const optLength = buffer[17];
    const commandIndex = 18 + optLength;
    const portIndex = commandIndex + 1;
    if (buffer.length < portIndex + 3) {
        throw new Error("Invalid VLESS header length");
    }

    const command = buffer[commandIndex];
    if (command !== VLESS_COMMAND_TCP) {
        throw new Error("Unsupported VLESS command");
    }

    const targetPort = (buffer[portIndex] << 8) | buffer[portIndex + 1];
    if (targetPort < 1 || targetPort > 65535) {
        throw new Error("Invalid target port");
    }

    let addressIndex = portIndex + 2;
    const addressType = buffer[addressIndex++];

    let targetAddress = "";
    if (addressType === 1) {
        if (buffer.length < addressIndex + 4) {
            throw new Error("Invalid IPv4 address");
        }
        targetAddress = buffer.slice(addressIndex, addressIndex + 4).join(".");
        addressIndex += 4;
    } else if (addressType === 2) {
        const domainLength = buffer[addressIndex++];
        if (!domainLength || buffer.length < addressIndex + domainLength) {
            throw new Error("Invalid domain address");
        }
        targetAddress = textDecoder.decode(buffer.slice(addressIndex, addressIndex + domainLength));
        if (!targetAddress.trim()) {
            throw new Error("Empty domain address");
        }
        addressIndex += domainLength;
    } else if (addressType === 3) {
        if (buffer.length < addressIndex + 16) {
            throw new Error("Invalid IPv6 address");
        }
        targetAddress = readIPv6(buffer, addressIndex);
        addressIndex += 16;
    } else {
        throw new Error("Unsupported address type");
    }

    if (!targetAddress) {
        throw new Error("Empty target address");
    }

    return {
        targetAddress,
        targetPort,
        payload: buffer.slice(addressIndex),
    };
}

function getEarlyData(req: Request) {
    const protocol = req.headers.get("sec-websocket-protocol");
    if (!protocol) return null;

    const candidates = protocol
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

    const candidate = candidates.find((item) =>
        /^[A-Za-z0-9_-]+$/.test(item) && item.length >= 24
    );
    if (!candidate || candidate.length < 24) return null;

    try {
        return decodeBase64Url(candidate);
    } catch {
        return null;
    }
}

async function pipeTcpToWebSocket(socket: WebSocket, readable: ReadableStream<Uint8Array>) {
    const reader = readable.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (socket.readyState !== WS_READY_STATE_OPEN) break;
            socket.send(value);
        }
    } finally {
        try { reader.releaseLock(); } catch {}
        closeSocket(socket, 1000, "TCP closed");
    }
}

function shouldHandleWebSocket(req: Request) {
    return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

function handleHttp(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === ADMIN_PATH) {
        return html(buildAdminHtml(req));
    }
    return html(CAMOUFLAGE_HTML);
}

async function connectTarget(socket: WebSocket, firstChunk: Uint8Array): Promise<TargetConnection> {
    const { targetAddress, targetPort, payload } = parseVlessRequest(firstChunk);
    const conn = await Deno.connect({
        hostname: targetAddress,
        port: targetPort,
    });

    const writer = conn.writable.getWriter();

    socket.send(VLESS_HEADER_RESPONSE);
    if (payload.length > 0) {
        await writer.write(payload);
    }

    void pipeTcpToWebSocket(socket, conn.readable);
    return { writer, conn };
}

function renderDashboardRows(items: DashboardItem[]) {
    return items.map(({ label, value, escape = true }) => `
                    <tr>
                        <td class="param-label">${escapeHtml(label)}</td>
                        <td class="param-value">${escape ? escapeHtml(value) : value}</td>
                    </tr>`).join("");
}

function buildAdminHtml(req: Request) {
    const url = new URL(req.url);
    const host = url.host;
    const origin = url.origin;

    const wsPath = "/";
    const dashboardPath = ADMIN_PATH;
    const tls = "tls";
    const port = "443";
    const protocol = "vless";
    const transport = "ws";

    const vlessLink =
        `vless://${userID}@${host}:${port}?encryption=none&security=${tls}&type=${transport}&host=${encodeURIComponent(host)}&path=%2F#deno-deploy`;

    const deploymentId = Deno.env.get("DENO_DEPLOYMENT_ID") ?? "unknown";
    const region = Deno.env.get("DENO_REGION") ?? "global";
    const rows = renderDashboardRows([
        { label: "域名", value: host },
        { label: "协议", value: protocol, escape: false },
        { label: "传输", value: transport, escape: false },
        { label: "TLS", value: tls, escape: false },
        { label: "端口", value: port, escape: false },
        { label: "路径", value: wsPath },
        { label: "UUID", value: userID },
        { label: "后台地址", value: origin + dashboardPath },
        { label: "部署 ID", value: deploymentId },
        { label: "区域", value: region },
    ]);

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>节点后台</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: #fafafa;
            color: #1a1a1a;
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
        }
        .wrap {
            max-width: 640px;
            margin: 0 auto;
            padding: 48px 24px 64px;
        }
        header {
            margin-bottom: 40px;
        }
        .status {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            color: #22c55e;
            margin-bottom: 12px;
        }
        .status::before {
            content: "";
            display: inline-block;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #22c55e;
        }
        h1 {
            font-size: 22px;
            font-weight: 600;
            letter-spacing: -0.02em;
            color: #111;
        }
        .desc {
            font-size: 14px;
            color: #888;
            margin-top: 4px;
        }
        section {
            margin-bottom: 32px;
        }
        .section-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: #999;
            margin-bottom: 12px;
        }
        .card {
            background: #fff;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            overflow: hidden;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        tr + tr {
            border-top: 1px solid #f0f0f0;
        }
        td {
            padding: 11px 16px;
            font-size: 14px;
        }
        .param-label {
            color: #888;
            width: 96px;
            white-space: nowrap;
        }
        .param-value {
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
            font-size: 13px;
            color: #333;
            word-break: break-all;
        }
        .link-box {
            background: #fff;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            padding: 16px;
        }
        .link-content {
            background: #f7f7f8;
            border: 1px solid #ebebeb;
            border-radius: 6px;
            padding: 12px 14px;
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
            font-size: 12px;
            color: #444;
            line-height: 1.7;
            word-break: break-all;
            max-height: 120px;
            overflow-y: auto;
        }
        .link-actions {
            margin-top: 12px;
            display: flex;
            gap: 8px;
        }
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 8px 14px;
            font-size: 13px;
            font-weight: 500;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            background: #fff;
            color: #333;
            cursor: pointer;
            transition: background 0.15s, border-color 0.15s;
        }
        .btn:hover {
            background: #f5f5f5;
            border-color: #bbb;
        }
        .btn:active {
            background: #eee;
        }
        .btn-primary {
            background: #111;
            color: #fff;
            border-color: #111;
        }
        .btn-primary:hover {
            background: #333;
            border-color: #333;
        }
        .btn-primary:active {
            background: #000;
        }
        .toast {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            background: #111;
            color: #fff;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 13px;
            opacity: 0;
            transition: opacity 0.2s, transform 0.2s;
            pointer-events: none;
        }
        .toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        .note {
            font-size: 13px;
            color: #aaa;
            line-height: 1.8;
        }
        .note code {
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
            font-size: 12px;
            background: #f0f0f0;
            padding: 2px 5px;
            border-radius: 3px;
            color: #666;
        }
        @media (max-width: 480px) {
            .wrap { padding: 32px 16px 48px; }
            h1 { font-size: 20px; }
            .param-label { width: 80px; }
        }
    </style>
</head>
<body>
    <div class="wrap">
        <header>
            <div class="status">运行中</div>
            <h1>VLESS 节点后台</h1>
            <p class="desc">查看连接参数与部署状态</p>
        </header>

        <section>
            <div class="section-title">连接参数</div>
            <div class="card">
                <table>
${rows}
                </table>
            </div>
        </section>

        <section>
            <div class="section-title">快速连接</div>
            <div class="link-box">
                <div class="link-content" id="vlessLink">${escapeHtml(vlessLink)}</div>
                <div class="link-actions">
                    <button class="btn btn-primary" onclick="copyLink()">复制链接</button>
                </div>
            </div>
        </section>

        <section>
            <p class="note">
                直接访问域名显示伪装页面，访问 <code>/${escapeHtml(userID)}</code> 进入后台。<br>
                客户端配置：地址填域名，端口 <code>443</code>，传输 <code>ws</code>，路径 <code>/</code>。
            </p>
        </section>
    </div>

    <div class="toast" id="toast">已复制到剪贴板</div>

    <script>
        function showToast(msg) {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 1500);
        }
        async function copyLink() {
            const text = document.getElementById('vlessLink').textContent || '';
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                    showToast('已复制到剪贴板');
                    return;
                }
            } catch (_) {}
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showToast('已复制到剪贴板');
        }
    </script>
</body>
</html>
`;
}

Deno.serve(async (req) => {
    if (!shouldHandleWebSocket(req)) {
        return handleHttp(req);
    }

    const { socket, response } = Deno.upgradeWebSocket(req);
    let target: TargetConnection | null = null;
    let connecting: Promise<TargetConnection> | null = null;
    let queue: Promise<void> = Promise.resolve();
    const earlyData = getEarlyData(req);

    const cleanup = () => {
        closeTarget(target);
        target = null;
        connecting = null;
    };

    const enqueue = (fn: () => Promise<void>) => {
        queue = queue.then(fn).catch(() => {
            cleanup();
            closeSocket(socket);
        });
    };

    const ensureConnection = async (buffer: Uint8Array) => {
        if (target) return;
        if (!connecting) {
            connecting = connectTarget(socket, buffer);
        }
        try {
            target = await connecting;
        } finally {
            connecting = null;
        }
    };

    socket.onopen = () => {
        if (!earlyData?.length) return;
        enqueue(async () => {
            await ensureConnection(earlyData);
        });
    };

    socket.onmessage = (event) => {
        enqueue(async () => {
            const buffer = await toUint8Array(event.data);
            if (target) {
                await target.writer.write(buffer);
                return;
            }
            await ensureConnection(buffer);
        });
    };

    socket.onclose = () => cleanup();
    socket.onerror = () => {
        cleanup();
        closeSocket(socket);
    };

    return response;
});
