import { api } from './client.js';

/**
 * The API, grouped the way the panels use it.
 *
 * Thin on purpose: no caching, no transformation, no business rules. Anything
 * clever here would be a second copy of a rule that already lives on the server,
 * and two copies of a rule drift.
 */

export const auth = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
};

export const catalog = {
  get: () => api.get('/catalog'),
  // One brand's models, fetched when a brand is actually chosen. The full
  // catalogue used to embed all 2044 and was the heaviest response in the
  // product, paid on every visit to the search page and both listing forms.
  brandModels: (id) => api.get(`/catalog/brands/${id}/models`),
};

export const havale = {
  list: (filters) => api.get('/havales', filters),
  mine: (filters) => api.get('/havales/mine', filters),
  get: (id) => api.get(`/havales/${id}`),
  create: (payload) => api.post('/havales', payload),
  update: (id, payload) => api.patch(`/havales/${id}`, payload),
  renew: (id, payload) => api.post(`/havales/${id}/renew`, payload),
  fulfill: (id) => api.post(`/havales/${id}/fulfill`),
  remove: (id) => api.delete(`/havales/${id}`),
  reveal: (id) => api.post(`/havales/${id}/reveal`),
  usage: () => api.get('/havales/reveal-usage'),
};

export const subscription = {
  me: () => api.get('/subscriptions/me'),
  invoice: () => api.get('/subscriptions/invoice'),
  seats: () => api.get('/subscriptions/seats'),
  plans: () => api.get('/subscriptions/plans'),
  orderSeats: (seats, note) => api.post('/subscriptions/seat-orders', { seats, note }),
  myOrders: () => api.get('/subscriptions/seat-orders'),
  seatAlerts: () => api.get('/subscriptions/seat-orders/alerts'),
  ackSeatOrder: (id) => api.post(`/subscriptions/seat-orders/${id}/ack`),
  pendingOrders: () => api.get('/subscriptions/seat-orders/pending'),
  reviewOrder: (id, approve, note) =>
    api.post(`/subscriptions/seat-orders/${id}/review`, { approve, note }),
  grant: (userId, planId, note) => api.post('/subscriptions/grant', { userId, planId, note }),
};

export const subAgents = {
  list: () => api.get('/sub-agents'),
  create: (payload) => api.post('/sub-agents', payload),
  setStatus: (id, status) => api.put(`/sub-agents/${id}/status`, { status }),
  setPassword: (id, password) => api.put(`/sub-agents/${id}/password`, { password }),
  brands: (id) => api.get(`/sub-agents/${id}/brands`),
  setBrands: (id, picked) => api.put(`/sub-agents/${id}/brands`, picked),
};

/** Owner only — every one of these is refused with 403 for anybody else. */
export const staff = {
  list: () => api.get('/admin/staff'),
  options: () => api.get('/admin/staff/options'),
  create: (payload) => api.post('/admin/staff', payload),
  update: (id, payload) => api.patch(`/admin/staff/${id}`, payload),
  setPassword: (id, password) => api.put(`/admin/staff/${id}/password`, { password }),
};

export const reports = {
  file: (payload) => api.post('/reports', payload),
  againstMe: () => api.get('/reports/against-me'),
  queue: (query) => api.get('/reports', query),
  pendingApproval: () => api.get('/reports/pending-approval'),
  review: (id, verdict, note) => api.post(`/reports/${id}/review`, { verdict, note }),
  hold: (id, note) => api.post(`/reports/${id}/hold`, { note }),
  approveSuspension: (id) => api.post(`/reports/${id}/approve-suspension`),
};

export const tickets = {
  list: (status) => api.get('/tickets', { status }),
  get: (id) => api.get(`/tickets/${id}`),
  create: (payload) => api.post('/tickets', payload),
  reply: (id, body) => api.post(`/tickets/${id}/messages`, { body }),
  // FormData variants: same endpoints, files attached. The client sends a
  // FormData body as multipart and leaves the boundary to the browser.
  createForm: (formData) => api.post('/tickets', formData),
  replyForm: (id, formData) => api.post(`/tickets/${id}/messages`, formData),
  setStatus: (id, status) => api.put(`/tickets/${id}/status`, { status }),
  setPriority: (id, priority) => api.put(`/tickets/${id}/priority`, { priority }),
};

export const admin = {
  overview: () => api.get('/admin/overview'),
  badges: () => api.get('/admin/badges'),
  activity: (query) => api.get('/admin/activity', query),
  activityDetail: (id) => api.get(`/admin/activity/${id}`),
  reveals: (query) => api.get('/admin/reveals', query),
  suspicious: (query) => api.get('/admin/suspicious', query),

  agents: (query) => api.get('/admin/agents', query),
  agent: (id) => api.get(`/admin/agents/${id}`),
  createAgent: (payload) => api.post('/admin/agents', payload),
  updateAgent: (id, payload) => api.patch(`/admin/agents/${id}`, payload),
  setAgentStatus: (id, status) => api.put(`/admin/agents/${id}/status`, { status }),
  setAgentPassword: (id, password) => api.put(`/admin/agents/${id}/password`, { password }),
  forceLogout: (id) => api.post(`/admin/agents/${id}/logout`),
  setAgentLimits: (id, payload) => api.put(`/admin/agents/${id}/limits`, payload),

  catalog: () => api.get('/admin/catalog'),
  modelUsage: (id) => api.get(`/admin/catalog/models/${id}/usage`),
  brandModels: (id) => api.get(`/admin/catalog/brands/${id}/models`),
  agentBrands: (id) => api.get(`/admin/agents/${id}/brands`),
  setAgentBrands: (id, { brandIds, modelIds }) => api.put(`/admin/agents/${id}/brands`, { brandIds, modelIds }),
  createCompany: (payload) => api.post('/admin/catalog/companies', payload),
  updateCompany: (id, payload) => api.patch(`/admin/catalog/companies/${id}`, payload),
  createBrand: (payload) => api.post('/admin/catalog/brands', payload),
  updateBrand: (id, payload) => api.patch(`/admin/catalog/brands/${id}`, payload),
  createModel: (payload) => api.post('/admin/catalog/models', payload),
  updateModel: (id, payload) => api.patch(`/admin/catalog/models/${id}`, payload),
  createColor: (payload) => api.post('/admin/catalog/colors', payload),
  updateColor: (id, payload) => api.patch(`/admin/catalog/colors/${id}`, payload),

  settings: () => api.get('/settings'),
  setSetting: (key, value) => api.put(`/settings/${key}`, { value }),
  smsStatus: () => api.get('/sms/status'),
  setSmsStatus: (enabled) => api.put('/sms/status', { enabled }),
  smsOutbox: (limit) => api.get('/sms/outbox', { limit }),
};
