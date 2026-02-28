/**
 * Navigator User-Agent Client Hints API
 * @see https://developer.mozilla.org/en-US/docs/Web/API/NavigatorUAData
 */
interface NavigatorUAData {
  readonly platform: string;
  readonly brands: readonly { brand: string; version: string }[];
  readonly mobile: boolean;
}

interface Navigator {
  readonly userAgentData?: NavigatorUAData;
}
