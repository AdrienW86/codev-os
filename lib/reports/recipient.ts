import { z } from "zod";
/** Shared browser/server validation: one explicit mailbox, no header separators. */
export const recipientSchema = z.string().trim().max(320).email().refine((value) => !/[\s,;<>\r\n]/.test(value));
