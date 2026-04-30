export interface ApiSuccess<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface ApiError {
  error: string;
  code?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number | null;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number | null;
  page: number;
  limit: number;
  totalPages?: number;
  /** When set: more rows exist after this page (`skip + items.length < total`). */
  hasMore?: boolean;
}
