import { z } from "zod";

export const SessionMetaSchema = z.object({
  id: z.string(),
  requestCount: z.number().int().nonnegative(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  title: z.string().optional(),
  parentID: z.string().optional(),
  subSessions: z.array(z.string()).optional(),
  folderPath: z.string().optional(),
});

export const SessionTreeNodeSchema = SessionMetaSchema.extend({
  children: z.array(SessionMetaSchema),
});

export const SessionMetadataFileSchema = z.object({
  sessionId: z.string(),
  title: z.string().optional(),
  enabled: z.boolean().optional(),
  parentID: z.string().optional(),
  subSessions: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const ExportManifestSchema = z.object({
  exportedAt: z.string(),
  mainSession: z.string(),
  sessions: z.array(z.string()),
  version: z.string(),
});

export const ConflictInfoSchema = z.object({
  sessionId: z.string(),
  existing: z.object({
    requestCount: z.number().int().nonnegative(),
    createdAt: z.string(),
  }),
  importing: z.object({
    requestCount: z.number().int().nonnegative(),
    createdAt: z.string(),
  }),
});

export const ImportedSessionInfoSchema = z.object({
  sessionId: z.string(),
  requestCount: z.number().int().nonnegative(),
  strategy: z.enum(["none", "rename", "skip", "overwrite"]),
  newId: z.string().optional(),
});

export const ImportResultSchema = z.object({
  status: z.enum(["success", "conflict"]),
  conflicts: z.array(ConflictInfoSchema).optional(),
  importedSessions: z.array(ImportedSessionInfoSchema).optional(),
});
