import { cmdSetEnabled } from "./enable.js";

export async function cmdDisable(args: string[]): Promise<void> {
  await cmdSetEnabled(args, false);
}