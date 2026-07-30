import { ServiceUnavailableException } from '@nestjs/common';

export function findingsUnavailable(message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    error: 'Service Unavailable',
    message,
    availability: 'unavailable',
  });
}
