// API configuration
export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_BASE_URL || '',
  ENDPOINTS: {
    COMPANIES: '/api/companies',
    METRICS: '/api/metrics',
    DATA: '/api/data'
  },
  getFullUrl: (endpoint: string) => {
    // If the endpoint is already a full URL, return it as is
    if (endpoint.startsWith('http')) {
      return endpoint;
    }
    // Otherwise, prepend the base URL
    return `${API_CONFIG.BASE_URL}${endpoint}`;
  }
};
