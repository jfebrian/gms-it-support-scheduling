import { promises as fs } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ZodType } from 'zod';
import {
	ChurchesFile,
	RegionsFile,
	Settings,
	VolunteersFile,
	YouTubeChannelsFile,
	type Church,
	type Region,
	type Settings as SettingsT,
	type Volunteer,
	type YouTubeChannel
} from './schemas';

/**
 * Data directory. Resolved from the current working directory (project root when run via
 * `npm run dev`). If we ever change how the app is launched, this is the single place to
 * update.
 */
export const DATA_DIR = join(process.cwd(), 'data');

// ---------------------------------------------------------------------------
// Generic YAML/JSON I/O with Zod validation
// ---------------------------------------------------------------------------

export async function readYaml<T>(relativePath: string, schema: ZodType<T>): Promise<T> {
	const abs = join(DATA_DIR, relativePath);
	const raw = await fs.readFile(abs, 'utf-8');
	const parsed = parseYaml(raw);
	return schema.parse(parsed);
}

/**
 * Atomic file write: writes to a temp file in the same directory, then renames.
 * If the app crashes mid-write, the destination file is either untouched or
 * fully replaced — never half-written.
 */
async function atomicWriteFile(abs: string, contents: string): Promise<void> {
	await fs.mkdir(dirname(abs), { recursive: true });
	const tmp = join(dirname(abs), `.${basename(abs)}.${randomBytes(4).toString('hex')}.tmp`);
	try {
		await fs.writeFile(tmp, contents, 'utf-8');
		await fs.rename(tmp, abs);
	} catch (err) {
		// Best-effort cleanup of the temp file if rename failed.
		try {
			await fs.unlink(tmp);
		} catch {
			// ignore
		}
		throw err;
	}
}

export async function writeYaml<T>(
	relativePath: string,
	schema: ZodType<T>,
	data: T
): Promise<void> {
	const validated = schema.parse(data);
	const abs = join(DATA_DIR, relativePath);
	// `yaml.stringify` produces LF-terminated output with a trailing newline; good for git.
	await atomicWriteFile(abs, stringifyYaml(validated));
}

export async function readJson<T>(relativePath: string, schema: ZodType<T>): Promise<T> {
	const abs = join(DATA_DIR, relativePath);
	const raw = await fs.readFile(abs, 'utf-8');
	const parsed = JSON.parse(raw);
	return schema.parse(parsed);
}

export async function writeJson<T>(
	relativePath: string,
	schema: ZodType<T>,
	data: T
): Promise<void> {
	const validated = schema.parse(data);
	const abs = join(DATA_DIR, relativePath);
	await atomicWriteFile(abs, JSON.stringify(validated, null, 2) + '\n');
}

/** Returns true if a file exists at `relativePath` under DATA_DIR. */
export async function exists(relativePath: string): Promise<boolean> {
	try {
		await fs.access(join(DATA_DIR, relativePath));
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Whole-config loader with cross-reference validation
// ---------------------------------------------------------------------------

export interface AppConfig {
	regions: Region[];
	churches: Church[];
	volunteers: Volunteer[];
	youtubeChannels: YouTubeChannel[];
	settings: SettingsT;
}

/**
 * Loads all top-level config files and validates cross-references between them.
 * Throws a single aggregated error if any references don't resolve.
 */
export async function loadAppConfig(): Promise<AppConfig> {
	const [regions, churches, volunteers, youtubeChannels, settings] = await Promise.all([
		readYaml('regions.yaml', RegionsFile),
		readYaml('churches.yaml', ChurchesFile),
		readYaml('volunteers.yaml', VolunteersFile),
		readYaml('youtube_channels.yaml', YouTubeChannelsFile),
		readYaml('settings.yaml', Settings)
	]);

	const regionIds = new Set(regions.map((r) => r.id));
	const churchIds = new Set(churches.map((c) => c.id));
	const channelIds = new Set(youtubeChannels.map((c) => c.id));
	const volunteerIds = new Set(volunteers.map((v) => v.id));

	const errors: string[] = [];

	// Unique ids within each collection
	for (const [label, arr] of [
		['region', regions],
		['church', churches],
		['volunteer', volunteers],
		['youtubeChannel', youtubeChannels]
	] as const) {
		const seen = new Set<string>();
		for (const item of arr) {
			if (seen.has(item.id)) errors.push(`Duplicate ${label} id '${item.id}'`);
			seen.add(item.id);
		}
	}

	// Cross-references: churches
	for (const church of churches) {
		if (church.youtubeChannelId && !channelIds.has(church.youtubeChannelId)) {
			errors.push(
				`Church '${church.id}' references unknown youtubeChannelId '${church.youtubeChannelId}'`
			);
		}
		if (church.youtubeChannelId && !church.livestream) {
			errors.push(
				`Church '${church.id}' has youtubeChannelId set but livestream=false`
			);
		}
	}

	// Cross-references: volunteers
	for (const v of volunteers) {
		if (v.homeChurchId && !churchIds.has(v.homeChurchId)) {
			errors.push(
				`Volunteer '${v.id}' references unknown homeChurchId '${v.homeChurchId}'`
			);
		}
		for (const cid of v.assignableChurchIds) {
			if (!churchIds.has(cid)) {
				errors.push(
					`Volunteer '${v.id}' references unknown church '${cid}' in assignableChurchIds`
				);
			}
		}
	}

	// Cross-references: youtube channels
	for (const ch of youtubeChannels) {
		if (!regionIds.has(ch.regionId)) {
			errors.push(
				`YouTubeChannel '${ch.id}' references unknown regionId '${ch.regionId}'`
			);
		}
		for (const cid of ch.servesChurchIds) {
			if (!churchIds.has(cid)) {
				errors.push(
					`YouTubeChannel '${ch.id}' references unknown church '${cid}' in servesChurchIds`
				);
			}
		}
	}

	if (errors.length) {
		throw new Error(
			`Config validation failed:\n  - ${errors.join('\n  - ')}\n(Fix the above in data/ files and restart.)`
		);
	}

	// Mark volunteerIds as read to silence the unused-var check in future refactors.
	void volunteerIds;

	return { regions, churches, volunteers, youtubeChannels, settings };
}
