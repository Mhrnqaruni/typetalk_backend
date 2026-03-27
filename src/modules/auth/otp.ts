import { generateOtpCode, hashOtpCode } from "../../lib/crypto";

export function createOtpChallenge(secretKey: string): { code: string; codeHash: string } {
  const code = generateOtpCode();

  return {
    code,
    codeHash: hashOtpCode(code, secretKey)
  };
}
