import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

export class MetabaseClient {
    private client: AxiosInstance;

    constructor() {
        if (!config.metabaseBaseUrl || !config.metabaseApiKey) {
            throw new Error('Metabase configuration missing. Set METABASE_BASE_URL and METABASE_API_KEY in .env.');
        }

        this.client = axios.create({
            baseURL: config.metabaseBaseUrl,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.metabaseApiKey,
            },
        });
    }

    getBaseUrl(): string {
        return config.metabaseBaseUrl;
    }

    async validateConnection(): Promise<boolean> {
        try {
            await this.client.get('/api/user/current');
            return true;
        } catch (error) {
            console.error('Failed to connect to Metabase:', error);
            return false;
        }
    }

    async getCard(cardId: number): Promise<any> {
        try {
            const response = await this.client.get(`/api/card/${cardId}`);
            return response.data;
        } catch (error) {
            console.error(`Error fetching card ${cardId}:`, error);
            throw error;
        }
    }

    async getTables(): Promise<any[]> {
        try {
            const response = await this.client.get('/api/table');
            return response.data;
        } catch (error) {
            console.error('Error fetching tables:', error);
            throw error;
        }
    }

    async getFields(databaseId: number): Promise<any[]> {
        try {
            const response = await this.client.get(`/api/database/${databaseId}/metadata`);
            return response.data.tables.flatMap((t: any) => t.fields);
        } catch (error) {
            console.error(`Error fetching fields for db ${databaseId}:`, error);
            throw error;
        }
    }

    async getTableMetadata(tableId: number): Promise<any> {
        try {
            const response = await this.client.get(`/api/table/${tableId}`);
            return response.data;
        } catch (error) {
            console.error(`Error fetching table ${tableId}:`, error);
            return null;
        }
    }

    async getField(fieldId: number): Promise<any> {
        try {
            const response = await this.client.get(`/api/field/${fieldId}`);
            return response.data;
        } catch (error) {
            console.error(`Error fetching field ${fieldId}:`, error);
            return null;
        }
    }

    async getDatabaseMetadata(databaseId: number): Promise<any> {
        try {
            const response = await this.client.get(`/api/database/${databaseId}/metadata?include_hidden=true`);
            return response.data;
        } catch (error) {
            console.error(`Error fetching metadata for db ${databaseId}:`, error);
            throw error;
        }
    }

    async createCard(cardDefinition: any): Promise<any> {
        try {
            const response = await this.client.post('/api/card', cardDefinition);
            return response.data;
        } catch (error) {
            console.error('Error creating card:', error);
            throw error;
        }
    }

    async searchCards(query: string): Promise<any[]> {
        try {
            const response = await this.client.get('/api/search', {
                params: {
                    q: query,
                    models: 'card'
                }
            });
            return response.data.data || [];
        } catch (error) {
            console.error('Error searching cards:', error);
            throw error;
        }
    }

    async getAllCards(): Promise<any[]> {
        try {
            const response = await this.client.get('/api/card');
            return response.data || [];
        } catch (error) {
            console.error('Error fetching all cards:', error);
            throw error;
        }
    }

    async queryCard(cardId: number): Promise<any> {
        try {
            const response = await this.client.post(`/api/card/${cardId}/query`);
            return response.data;
        } catch (error) {
            console.error(`Error querying card ${cardId}:`, error);
            throw error;
        }
    }

    async updateCard(cardId: number, updates: any): Promise<any> {
        try {
            const response = await this.client.put(`/api/card/${cardId}`, updates);
            return response.data;
        } catch (error) {
            console.error(`Error updating card ${cardId}:`, error);
            throw error;
        }
    }
}
