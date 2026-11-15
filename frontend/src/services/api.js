import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = window.localStorage.getItem('raceproof_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && window.localStorage.getItem('raceproof_token')) {
      window.dispatchEvent(new CustomEvent('raceproof:unauthorized'));
    }
    return Promise.reject(error);
  },
);

export function apiErrorMessage(error) {
  return error?.response?.data?.message || error?.message || 'Something went wrong. Please try again.';
}

export const authApi = {
  register: async (input) => (await api.post('/auth/register', input)).data.data.user,
  login: async (input) => (await api.post('/auth/login', input)).data.data,
  me: async () => (await api.get('/auth/me')).data.data.user,
};

export const teamsApi = {
  mine: async () => (await api.get('/teams/my')).data.data.teams,
  myRequests: async (params = {}) => (await api.get('/teams/my/requests', { params })).data.data,
  create: async (input) => (await api.post('/teams', input, { headers: { 'Idempotency-Key': crypto.randomUUID() } })).data.data.team,
  get: async (teamId) => (await api.get(`/teams/${teamId}`)).data.data.team,
  join: async (teamId) => (await api.post(`/teams/${teamId}/join-requests`, {})).data.data.joinRequest,
  requests: async (teamId) => (await api.get(`/teams/${teamId}/join-requests`)).data.data.joinRequests,
  accept: async (teamId, requestId) => (await api.post(`/teams/${teamId}/join-requests/${requestId}/accept`, {})).data.data,
  decline: async (teamId, requestId) => (await api.post(`/teams/${teamId}/join-requests/${requestId}/decline`, {})).data.data,
  remove: async (teamId, memberId) => (await api.delete(`/teams/${teamId}/members/${memberId}`)).data.data,
  leave: async (teamId) => (await api.delete(`/teams/${teamId}/leave`)).data.data,
  createInvite: async (teamId, expiresInHours) => (await api.post(`/teams/${teamId}/invites`, { expiresInHours })).data.data.invite,
  invites: async (teamId) => (await api.get(`/teams/${teamId}/invites`)).data.data.invites,
  revokeInvite: async (teamId, inviteId) => (await api.delete(`/teams/${teamId}/invites/${inviteId}`)).data.data,
  redeemInvite: async (code) => (await api.post('/teams/invites/redeem', { code })).data.data,
  suggestions: async (teamId) => (await api.get(`/teams/${teamId}/suggestions`)).data.data,
};

export const hackathonsApi = {
  list: async (params = {}) => (await api.get('/hackathons', { params })).data.data,
  get: async (hackathonId) => (await api.get(`/hackathons/${hackathonId}`)).data.data.hackathon,
  teams: async (hackathonId, params = {}) => (await api.get(`/hackathons/${hackathonId}/teams`, { params })).data.data,
};
