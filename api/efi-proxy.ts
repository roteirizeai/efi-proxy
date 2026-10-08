/* Ponte mTLS para o Efí — para rodar no Vercel (vercel.com).

   Por quê: o Efí só aceita chamadas acompanhadas do certificado digital da
   conta (mTLS). O servidor onde o site publicado roda não consegue apresentar
   esse certificado. Esta ponte apresenta o certificado e repassa a resposta.

   Variáveis de ambiente no Vercel (mesmos valores do cofre do projeto):
     EFI_CERTIFICATE_PEM      — certificado (-----BEGIN CERTIFICATE-----)
     EFI_CERTIFICATE_KEY_PEM  — chave privada (-----BEGIN PRIVATE KEY-----)
     EFI_PROXY_SECRET         — senha compartilhada com o site

   Deploy:
     1. Crie um repositório no GitHub e suba estes arquivos (api/efi-proxy.ts,
        package.json).
     2. Em vercel.com, importe o repositório.
     3. Adicione as 3 variáveis de ambiente acima.
     4. Deploy.
     5. O endereço da ponte será https://efi-proxy-xxx.vercel.app/api/efi-proxy
*/

import https from "node:https";

const HOST = "pix.api.efipay.com.br";

type ProxyRequest = {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
};

export default async function handler(req: any, res: any) {
  /* Health check — abrir no navegador mostra "efi-proxy ok". */
  if (req.method === "GET") {
    res.status(200).send("efi-proxy ok");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  /* Valida a senha compartilhada. */
  const expected = process.env.EFI_PROXY_SECRET ?? "";
  if (!expected || req.headers["x-proxy-secret"] !== expected) {
    res.status(401).send("Unauthorized");
    return;
  }

  /* Parse do corpo da requisição. */
  let payload: ProxyRequest;
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ status: 0, body: "Invalid body" });
    return;
  }

  const path = payload.path ?? "";
  if (!path.startsWith("/")) {
    res.status(400).json({ status: 0, body: "Invalid path" });
    return;
  }

  /* Carrega o certificado para mTLS. */
  const cert = process.env.EFI_CERTIFICATE_PEM ?? "";
  const key = process.env.EFI_CERTIFICATE_KEY_PEM ?? "";
  if (!cert || !key) {
    res.status(500).json({ status: 0, body: "Certificate not configured" });
    return;
  }

  /* Faz a chamada mTLS ao Efí. */
  const agent = new https.Agent({ cert, key, keepAlive: false });

  const request = https.request(
    {
      hostname: HOST,
      port: 443,
      method: payload.method ?? "GET",
      path,
      headers: {
        "User-Agent": "JuntosPeloPedro/1.0 (+https://juntoscompedro.org)",
        Accept: "application/json",
        ...(payload.headers ?? {}),
        ...(payload.body
          ? { "Content-Length": Buffer.byteLength(payload.body) }
          : {}),
      },
      agent,
    },
    (response: any) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        res.status(200).json({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    },
  );

  request.on("error", (error: any) => {
    res.status(502).json({
      status: 0,
      body: error instanceof Error ? error.message : String(error),
    });
  });

  if (payload.body) request.write(payload.body);
  request.end();
}
