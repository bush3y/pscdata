import axios from 'axios';

const client = axios.create({ baseURL: '/api/v1' });

client.interceptors.response.use(
  r => r,
  err => {
    console.error('API error:', err.response?.data || err.message);
    return Promise.reject(err);
  }
);

export default client;
