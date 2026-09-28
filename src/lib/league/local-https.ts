import https from "node:https";

/**
 * GET em JSON contra um serviço do LoL rodando nesta máquina.
 *
 * O cliente e o jogo servem HTTPS com um certificado autoassinado da Riot, que
 * nenhum navegador aceita — por isso a leitura passa pelo servidor do Next.
 * A verificação de certificado fica desligada **só** para 127.0.0.1: não sai
 * nada da máquina.
 */
export function localJson<T>(
  port: number,
  path: string,
  { headers = {}, timeoutMs = 1500 }: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { Accept: "application/json", ...headers },
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new LocalHttpError(res.statusCode ?? 0, path));
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new LocalHttpError(res.statusCode, path));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

export class LocalHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`HTTP ${status} em ${path}`);
  }
}
