import { apiClient, type ApiResponse } from './client';

export interface UploadedFileResponse {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  uploadedAt: string;
}

export const filesApi = {
  list: async () => {
    const response = await apiClient.listFiles();
    if (response.error) throw new Error('Failed to fetch files');
    return response.data;
  },

  upload: async (file: File): Promise<UploadedFileResponse> => {
    const response = (await apiClient.uploadFile(file)) as ApiResponse<UploadedFileResponse>;
    if (response.error) {
      const errorMessage =
        typeof response.error === 'string'
          ? response.error
          : response.error?.message || 'Failed to upload file';
      throw new Error(errorMessage);
    }
    if (!response.data) throw new Error('File upload failed');
    return response.data as UploadedFileResponse;
  },

  download: async (id: string) => {
    return apiClient.downloadFile(id);
  },

  delete: async (id: string) => {
    const response = await apiClient.deleteFile(id);
    if (response.error) throw new Error('Failed to delete file');
  },
};
