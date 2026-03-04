import { httpGet } from './client';

export interface OrgMember {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  avatarUrl: string | null;
}

export interface OrgMembersResponse {
  members: OrgMember[];
}

export const orgMembersApi = {
  list: async (): Promise<OrgMembersResponse> => {
    return httpGet<OrgMembersResponse>('/org/members');
  },
};
