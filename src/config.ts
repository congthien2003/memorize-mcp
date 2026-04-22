/**
 * Configuration management for memorize-mcp
 */
import { env } from "process";
import os from "os";

/**
 * Environment configuration
 */
export interface Config {
	// Local storage
	memoryDir: string;

	// Supabase configuration
	supabase: {
		url?: string;
		serviceRoleKey?: string;
		projectSlug?: string;
	};

	// v1.2.1: Agent file pull configuration
	agent: {
		targetProjectDir?: string;
	};

	// System info
	createdFrom: string;
}

/**
 * Get configuration from environment variables
 */
export function getConfig(): Config {
	return {
		memoryDir: env.MEMORIZE_MCP_PROJECT_ROOT || "./.memories/data",

		supabase: {
			url: env.MEMORIZE_MCP_SUPABASE_URL,
			serviceRoleKey: env.MEMORIZE_MCP_SUPABASE_SERVICE_ROLE_KEY,
			projectSlug: env.MEMORIZE_MCP_PROJECT_SLUG,
		},

		agent: {
			targetProjectDir: env.MEMORIZE_MCP_TARGET_PROJECT_DIR,
		},

		createdFrom: `${os.hostname()}@${os.userInfo().username}`,
	};
}

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(config: Config): boolean {
	return !!(config.supabase.url && config.supabase.serviceRoleKey);
}
