// HAR Types (simplified from har-format)
export interface HarHeader {
  name: string;
  value: string;
}

export interface HarRequest {
  method: string;
  url: string;
  httpVersion: string;
  headers: HarHeader[];
  queryString?: { name: string; value: string }[];
  postData?: {
    mimeType: string;
    text?: string;
  };
  headersSize: number;
  bodySize: number;
}

export interface HarResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: HarHeader[];
  content: {
    size: number;
    mimeType: string;
    text?: string;
  };
  headersSize: number;
  bodySize: number;
}

export interface HarTimings {
  blocked: number;
  dns: number;
  connect: number;
  ssl: number;
  send: number;
  wait: number;
  receive: number;
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  timings: HarTimings;
  cache: object;
}

export interface HttpEventData {
  correlationId: string;
  request?: HarRequest;
  har?: HarEntry;
  error?: {
    message: string;
    name?: string;
  };
}

export interface NetworkRequest {
  id: string;
  correlationId: string;
  nodeId: string;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  startTime: string;
  duration?: number;
  request?: HarRequest;
  response?: HarResponse;
  timings?: HarTimings;
  error?: { message: string; name?: string };
}
