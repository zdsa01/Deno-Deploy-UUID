// =========================================================
// Deno Edge Service - VLESS Proxy with Admin Panel
// 后台地址： https://你的域名/<UUID>
// =========================================================

// 1. 你的专属 UUID
const userID = "93f6e6d0-9593-4104-8991-f28bb00d59a0";

// 2. 后台路径：域名 + UUID
const ADMIN_PATH = `/${userID}`;

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
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store, no-cache, must-revalidate",
        },
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

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>节点后台</title>
    <style>
        :root {
            --bg: #0b1020;
            --panel: #121a2b;
            --panel2: #182338;
            --text: #e8eefc;
            --muted: #9fb0d1;
            --line: #2a3856;
            --ok: #22c55e;
            --accent: #60a5fa;
            --accent2: #93c5fd;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: linear-gradient(180deg, #09101d 0%, #0f172a 100%);
            color: var(--text);
        }
        .wrap {
            max-width: 980px;
            margin: 0 auto;
            padding: 32px 20px 56px;
        }
        .hero {
            background: linear-gradient(135deg, #172554 0%, #0f172a 60%, #111827 100%);
            border: 1px solid var(--line);
            border-radius: 20px;
            padding: 28px;
            box-shadow: 0 10px 30px rgba(0,0,0,.25);
        }
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            border-radius: 999px;
            background: rgba(34,197,94,.12);
            color: #bbf7d0;
            font-size: 13px;
            border: 1px solid rgba(34,197,94,.2);
        }
        .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--ok);
            box-shadow: 0 0 12px var(--ok);
        }
        h1 {
            margin: 16px 0 8px;
            font-size: 32px;
            line-height: 1.15;
        }
        .sub {
            color: var(--muted);
            margin: 0;
            line-height: 1.7;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 16px;
            margin-top: 22px;
        }
        .card {
            background: rgba(255,255,255,.03);
            border: 1px solid var(--line);
            border-radius: 16px;
            padding: 18px;
        }
        .label {
            color: var(--muted);
            font-size: 13px;
            margin-bottom: 8px;
        }
        .value {
            font-size: 16px;
            line-height: 1.6;
            word-break: break-all;
        }
        .mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .bigbox {
            margin-top: 22px;
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 18px;
            padding: 20px;
        }
        textarea {
            width: 100%;
            min-height: 120px;
            resize: vertical;
            border: 1px solid var(--line);
            background: var(--panel2);
            color: var(--text);
            border-radius: 12px;
            padding: 14px;
            font-size: 14px;
            line-height: 1.6;
        }
        .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-top: 14px;
        }
        button, a.btn {
            appearance: none;
            border: 0;
            cursor: pointer;
            border-radius: 12px;
            padding: 12px 16px;
            color: white;
            text-decoration: none;
            background: linear-gradient(135deg, var(--accent), var(--accent2));
            font-weight: 600;
        }
        .note {
            margin-top: 16px;
            color: var(--muted);
            line-height: 1.7;
            font-size: 14px;
        }
        .footer {
            margin-top: 26px;
            color: var(--muted);
            font-size: 13px;
            line-height: 1.7;
        }
    </style>
</head>
<body>
    <div class="wrap">
        <section class="hero">
            <div class="badge"><span class="dot"></span> 服务运行中</div>
            <h1>VLESS 节点后台</h1>
            <p class="sub">当前页面用于查看连接参数、协议类型、路径信息与部署状态。</p>

            <div class="grid">
                <div class="card">
                    <div class="label">域名</div>
                    <div class="value mono">${escapeHtml(host)}</div>
                </div>
                <div class="card">
                    <div class="label">协议</div>
                    <div class="value mono">${protocol}</div>
                </div>
                <div class="card">
                    <div class="label">传输</div>
                    <div class="value mono">${transport}</div>
                </div>
                <div class="card">
                    <div class="label">TLS</div>
                    <div class="value mono">${tls}</div>
                </div>
                <div class="card">
                    <div class="label">端口</div>
                    <div class="value mono">${port}</div>
                </div>
                <div class="card">
                    <div class="label">WebSocket 路径</div>
                    <div class="value mono">${escapeHtml(wsPath)}</div>
                </div>
                <div class="card">
                    <div class="label">后台地址</div>
                    <div class="value mono">${escapeHtml(origin + dashboardPath)}</div>
                </div>
                <div class="card">
                    <div class="label">UUID</div>
                    <div class="value mono">${escapeHtml(userID)}</div>
                </div>
                <div class="card">
                    <div class="label">部署 ID</div>
                    <div class="value mono">${escapeHtml(deploymentId)}</div>
                </div>
                <div class="card">
                    <div class="label">区域</div>
                    <div class="value mono">${escapeHtml(region)}</div>
                </div>
            </div>

            <div class="bigbox">
                <div class="label">VLESS 链接</div>
                <textarea id="vlessLink" readonly>${escapeHtml(vlessLink)}</textarea>
                <div class="actions">
                    <button onclick="copyText('vlessLink')">复制链接</button>
                </div>
                <div class="note">
                    后台打开方式：<span class="mono">${escapeHtml(origin + dashboardPath)}</span><br>
                    客户端连接参数：地址是当前域名，端口 443，UUID 为上面显示值，传输为 WS，路径为 <span class="mono">/</span>。
                </div>
            </div>

            <div class="footer">
                普通访问显示伪装页；访问 <span class="mono">/${escapeHtml(userID)}</span> 显示后台；WebSocket 请求继续走代理通道。
            </div>
        </section>
    </div>

    <script>
        function copyText(id) {
            const el = document.getElementById(id);
            el.select();
            el.setSelectionRange(0, 99999);
            document.execCommand('copy');
        }
    </script>
</body>
</html>
`;
}

Deno.serve(async (req) => {
    const url = new URL(req.url);
    const upgrade = req.headers.get("upgrade") || "";

    // 普通 HTTP 请求
    if (upgrade.toLowerCase() !== "websocket") {
        // 访问 /UUID 打开后台
        if (url.pathname === ADMIN_PATH) {
            return html(buildAdminHtml(req));
        }

        // 其他路径显示伪装页
        return html(CAMOUFLAGE_HTML);
    }

    // WebSocket 代理请求
    const { socket, response } = Deno.upgradeWebSocket(req);

    socket.onopen = () => {};

    socket.onmessage = async (event) => {
        try {
            const buffer = new Uint8Array(event.data as ArrayBuffer);

            // 验证 VLESS 协议版本
            if (buffer[0] !== 0) {
                socket.close();
                return;
            }

            // 解析并验证 UUID
            const incomingUUID = buffer.slice(1, 17);
            const expectedUUID = new Uint8Array(
                userID.match(/[\da-f]{2}/gi)!.map((h) => parseInt(h, 16))
            );

            let isValid = true;
            for (let i = 0; i < 16; i++) {
                if (incomingUUID[i] !== expectedUUID[i]) isValid = false;
            }

            if (!isValid) {
                socket.close();
                return;
            }

            // 解析目标地址与端口
            const optLength = buffer[17];
            const command = buffer[18 + optLength];
            const portIndex = 18 + optLength + 1;
            const targetPort = (buffer[portIndex] << 8) | buffer[portIndex + 1];

            let addressIndex = portIndex + 2;
            const addressType = buffer[addressIndex];
            addressIndex++;

            let targetAddress = "";
            if (addressType === 1) {
                targetAddress = buffer.slice(addressIndex, addressIndex + 4).join(".");
                addressIndex += 4;
            } else if (addressType === 2) {
                const domainLength = buffer[addressIndex];
                addressIndex++;
                targetAddress = new TextDecoder().decode(
                    buffer.slice(addressIndex, addressIndex + domainLength)
                );
                addressIndex += domainLength;
            } else if (addressType === 3) {
                const ipv6Parts = [];
                for (let i = 0; i < 16; i += 2) {
                    ipv6Parts.push(
                        ((buffer[addressIndex + i] << 8) | buffer[addressIndex + i + 1]).toString(16)
                    );
                }
                targetAddress = ipv6Parts.join(":");
                addressIndex += 16;
            }

            // 只处理 CONNECT 请求
            if (command === 1) {
                const targetConn = await Deno.connect({
                    hostname: targetAddress,
                    port: targetPort,
                });

                // 返回 VLESS 握手成功响应
                socket.send(new Uint8Array([buffer[0], 0]));

                // 发送初始载荷数据
                const initialData = buffer.slice(addressIndex);
                if (initialData.length > 0) {
                    await targetConn.write(initialData);
                }

                // 建立双向数据流管道
                const tcpToWs = async () => {
                    const tempBuf = new Uint8Array(32768);
                    try {
                        while (true) {
                            const n = await targetConn.read(tempBuf);
                            if (n === null) break;
                            socket.send(tempBuf.subarray(0, n));
                        }
                    } catch {
                    } finally {
                        socket.close();
                    }
                };

                const wsToTcp = async (data: ArrayBuffer) => {
                    try {
                        await targetConn.write(new Uint8Array(data));
                    } catch {
                        targetConn.close();
                    }
                };

                socket.onmessage = (e) => wsToTcp(e.data);
                socket.onclose = () => targetConn.close();
                socket.onerror = () => targetConn.close();

                tcpToWs();
            }
        } catch {
            socket.close();
        }
    };

    return response;
});
