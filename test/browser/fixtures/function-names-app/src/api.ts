// A small HTTP client with a typed error. Nothing here knows about Tracer.
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class ApiClient {
  private readonly base: string;
  static requests = 0;

  constructor(base: string) {
    this.base = base;
  }

  get baseUrl(): string {
    return this.base;
  }

  set baseUrl(value: string) {
    void value;
  }

  static count(): number {
    return ApiClient.requests;
  }

  async get<T>(path: string): Promise<T> {
    return this.send<T>('GET', path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>('POST', path, body);
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    ApiClient.requests += 1;
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new ApiError(response.status, `${method} ${path} failed`);
    return (await response.json()) as T;
  }
}

export const client = new ApiClient('');

export function describeStatus(code: number): string {
  return code >= 400 ? 'error' : 'ok';
}
