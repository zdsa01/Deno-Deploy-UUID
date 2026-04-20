// =========================================================
// Deno Edge Service - VLESS Proxy with Web Camouflage
// =========================================================

// 1. 你的专属 UUID (已填写)
const userID = "93f6e6d0-9593-4104-8991-f28bb00d59a0";

// 2. 伪装网页的 HTML 代码 (返回 200 OK，伪装成正常的 API 微服务)
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

// =========================================================
// 核心逻辑部分 (请勿随意修改下方代码)
// =========================================================

Deno.serve(async (req) => {
    const upgrade = req.headers.get("upgrade") || "";
    
    // 拦截普通 HTTP 请求，展示伪装网页
    if (upgrade.toLowerCase() !== "websocket") {
        return new Response(CAMOUFLAGE_HTML, {
            status: 200,
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store, no-cache, must-revalidate",
            },
        });
    }

    // 处理 WebSocket 代理请求
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
            const expectedUUID = new Uint8Array(userID.match(/[\da-f]{2}/gi)!.map(h => parseInt(h, 16)));
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
            if (addressType === 1) { // IPv4
                targetAddress = buffer.slice(addressIndex, addressIndex + 4).join(".");
                addressIndex += 4;
            } else if (addressType === 2) { // Domain
                const domainLength = buffer[addressIndex];
                addressIndex++;
                targetAddress = new TextDecoder().decode(buffer.slice(addressIndex, addressIndex + domainLength));
                addressIndex += domainLength;
            } else if (addressType === 3) { // IPv6
                const ipv6Parts = [];
                for (let i = 0; i < 16; i += 2) {
                    ipv6Parts.push(((buffer[addressIndex + i] << 8) | buffer[addressIndex + i + 1]).toString(16));
                }
                targetAddress = ipv6Parts.join(":");
                addressIndex += 16;
            }

            // 只处理 CONNECT 请求
            if (command === 1) {
                const targetConn = await Deno.connect({ hostname: targetAddress, port: targetPort });
                
                // 返回 VLESS 握手成功响应
                socket.send(new Uint8Array([buffer[0], 0]));

                // 发送初始载荷数据
                const initialData = buffer.slice(addressIndex);
                if (initialData.length > 0) {
                    await targetConn.write(initialData);
                }

                // 建立双向数据流管道 (TCP <-> WebSocket)
                const tcpToWs = async () => {
                    const tempBuf = new Uint8Array(32768);
                    try {
                        while (true) {
                            const n = await targetConn.read(tempBuf);
                            if (n === null) break;
                            socket.send(tempBuf.subarray(0, n));
                        }
                    } catch (e) {
                        // 忽略正常的连接断开错误
                    } finally {
                        socket.close();
                    }
                };

                const wsToTcp = async (data: ArrayBuffer) => {
                    try {
                        await targetConn.write(new Uint8Array(data));
                    } catch (e) {
                        targetConn.close();
                    }
                };

                socket.onmessage = (e) => wsToTcp(e.data);
                socket.onclose = () => targetConn.close();
                socket.onerror = () => targetConn.close();
                
                tcpToWs();
            }
        } catch (error) {
            socket.close();
        }
    };

    return response;
});
