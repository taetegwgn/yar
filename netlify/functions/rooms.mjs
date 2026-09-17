import { getStore } from '@netlify/blobs';
import { createRoomHandler } from '../../server/rooms.js';

export default async request => {
  const blobs = getStore({ name: 'yarureong-rooms', consistency: 'strong' });
  const store = {
    async get(id) {
      const value = await blobs.getWithMetadata(id, { type: 'json' });
      return value ? { data: value.data, etag: value.etag } : null;
    },
    async put(id, data, etag) {
      const result = await blobs.setJSON(id, data, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag });
      return result.modified;
    }
  };
  return createRoomHandler(store, { apiKey: process.env.GEMINI_API_KEY || '' })(request);
};

export const config = { path: ['/api/rooms', '/api/rooms/*'] };
