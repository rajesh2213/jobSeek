import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

export interface ResumeObjectStore {
  hasObject(key: string): Promise<boolean>;
  putObject(input: {
    key: string;
    body: Readable;
    contentType: string;
    contentLength: number;
  }): Promise<void>;
  getObject(key: string): Promise<{
    stream: Readable;
    contentType: string | null;
    contentLength: number | null;
  } | null>;
  deleteObject(key: string): Promise<void>;
}

let clientSingleton: S3Client | null = null;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for resume object storage`);
  }
  return value;
}

function getBucket(): string {
  return required("R2_BUCKET");
}

function getClient(): S3Client {
  if (clientSingleton) return clientSingleton;
  const endpoint = required("R2_ENDPOINT");
  const accessKeyId = required("R2_ACCESS_KEY_ID");
  const secretAccessKey = required("R2_SECRET_ACCESS_KEY");
  const region = process.env.R2_REGION?.trim() || "auto";
  clientSingleton = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  return clientSingleton;
}

function bodyToNodeStream(body: unknown): Readable | null {
  if (!body) return null;
  if (body instanceof Readable) return body;
  if (
    typeof body === "object" &&
    body !== null &&
    "transformToWebStream" in body &&
    typeof (body as { transformToWebStream?: unknown }).transformToWebStream === "function"
  ) {
    return Readable.fromWeb(
      (body as { transformToWebStream: () => ReadableStream }).transformToWebStream(),
    );
  }
  return null;
}

function isNotFoundError(err: unknown): boolean {
  return (
    err instanceof NoSuchKey ||
    (err instanceof S3ServiceException && err.name === "NoSuchKey") ||
    (err instanceof S3ServiceException && err.name === "NotFound")
  );
}

class R2ResumeObjectStore implements ResumeObjectStore {
  async hasObject(key: string): Promise<boolean> {
    try {
      await getClient().send(
        new HeadObjectCommand({
          Bucket: getBucket(),
          Key: key,
        }),
      );
      return true;
    } catch (err) {
      if (isNotFoundError(err)) return false;
      throw err;
    }
  }

  async putObject(input: {
    key: string;
    body: Readable;
    contentType: string;
    contentLength: number;
  }): Promise<void> {
    await getClient().send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
      }),
    );
  }

  async getObject(key: string): Promise<{
    stream: Readable;
    contentType: string | null;
    contentLength: number | null;
  } | null> {
    try {
      const out = await getClient().send(
        new GetObjectCommand({
          Bucket: getBucket(),
          Key: key,
        }),
      );
      const stream = bodyToNodeStream(out.Body);
      if (!stream) return null;
      return {
        stream,
        contentType: out.ContentType ?? null,
        contentLength:
          typeof out.ContentLength === "number" && Number.isFinite(out.ContentLength)
            ? out.ContentLength
            : null,
      };
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await getClient().send(
      new DeleteObjectCommand({
        Bucket: getBucket(),
        Key: key,
      }),
    );
  }
}

let storeSingleton: ResumeObjectStore | null = null;

export function getResumeObjectStore(): ResumeObjectStore {
  if (storeSingleton) return storeSingleton;
  storeSingleton = new R2ResumeObjectStore();
  return storeSingleton;
}
