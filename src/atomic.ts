import fs from "fs";
import path from "path";
import os from "os";

export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmp = path.join(os.tmpdir(), `paraglide-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  const text = JSON.stringify(data, null, "\t");
  await fs.promises.writeFile(tmp, text, "utf8");
  await fs.promises.rename(tmp, filePath).catch(async (err) => {
    if (err.code === "EXDEV") {
      await fs.promises.copyFile(tmp, filePath);
      await fs.promises.unlink(tmp);
    } else {
      throw err;
    }
  });
}
