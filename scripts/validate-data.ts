/**
 * Manually run: `npx tsx scripts/validate-data.ts`
 *
 * Loads every file under data/ via the same loaders the app uses at runtime
 * and prints a summary or aggregated errors. Good for CI and for sanity-
 * checking hand-edited YAML.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR, exists, loadAppConfig, readYaml, readJson } from '../src/lib/storage';
import {
	EventFile,
	FairnessLog,
	Incident,
	MonthlySchedule,
	UnavailabilityFile
} from '../src/lib/schemas';

async function main() {
	const errors: string[] = [];
	const warnings: string[] = [];

	// 1. Top-level cross-validated config
	const config = await loadAppConfig();
	console.log('✓ loadAppConfig: OK');
	console.log(
		`  regions=${config.regions.length}  churches=${config.churches.length}  ` +
			`volunteers=${config.volunteers.length}  channels=${config.youtubeChannels.length}`
	);

	const churchIds = new Set(config.churches.map((c) => c.id));
	const volunteerIds = new Set(config.volunteers.map((v) => v.id));

	// 2. Monthly schedules
	const schedulesDir = join(DATA_DIR, 'schedules');
	if (await exists('schedules')) {
		const files = (await readdir(schedulesDir)).filter((f) => f.endsWith('.yaml'));
		for (const f of files) {
			try {
				const s = await readYaml(`schedules/${f}`, MonthlySchedule);
				for (const a of s.assignments) {
					if (!churchIds.has(a.churchId)) {
						errors.push(`schedules/${f}: assignment '${a.id}' → unknown churchId '${a.churchId}'`);
					}
					for (const vid of a.volunteerIds) {
						if (!volunteerIds.has(vid)) {
							errors.push(`schedules/${f}: assignment '${a.id}' → unknown volunteerId '${vid}'`);
						}
					}
					// Shift existence
					const church = config.churches.find((c) => c.id === a.churchId);
					if (church && !church.weeklyShifts.some((sh) => sh.id === a.shiftId)) {
						errors.push(
							`schedules/${f}: assignment '${a.id}' → unknown shiftId '${a.shiftId}' for church '${a.churchId}'`
						);
					}
				}
				console.log(`✓ schedules/${f}: ${s.assignments.length} assignments`);
			} catch (err) {
				errors.push(`schedules/${f}: ${(err as Error).message}`);
			}
		}
	}

	// 3. Events
	const eventsDir = join(DATA_DIR, 'events');
	if (await exists('events')) {
		const files = (await readdir(eventsDir)).filter((f) => f.endsWith('.yaml'));
		for (const f of files) {
			try {
				const ev = await readYaml(`events/${f}`, EventFile);
				let totalServices = 0;
				let totalAssignments = 0;
				for (const block of ev.churches) {
					if (!churchIds.has(block.churchId)) {
						errors.push(`events/${f}: unknown churchId '${block.churchId}'`);
					}
					// Resolve effective services to check shift references when block.services is empty.
					const church = config.churches.find((c) => c.id === block.churchId);
					const effectiveServices =
						block.services.length > 0
							? block.services
							: (church?.weeklyServices ?? []).filter(
									(s) => s.dayOfWeek === 'sun' && s.kind !== 'other'
								);
					const svcIds = new Set(effectiveServices.map((s) => s.id));
					for (const sh of block.shifts) {
						for (const sid of sh.serviceIds) {
							if (!svcIds.has(sid)) {
								errors.push(
									`events/${f}: church '${block.churchId}' shift '${sh.id}' → unknown service id '${sid}'`
								);
							}
						}
					}
					for (const a of block.assignments) {
						for (const vid of a.volunteerIds) {
							if (!volunteerIds.has(vid)) {
								errors.push(
									`events/${f}: assignment '${a.id}' → unknown volunteerId '${vid}'`
								);
							}
						}
					}
					totalServices += effectiveServices.length;
					totalAssignments += block.assignments.length;
				}
				console.log(
					`✓ events/${f}: ${ev.churches.length} churches, ${totalServices} svc, ${totalAssignments} asg`
				);
			} catch (err) {
				errors.push(`events/${f}: ${(err as Error).message}`);
			}
		}
	}

	// 4. Unavailability
	if (await exists('unavailability')) {
		const unavailDir = join(DATA_DIR, 'unavailability');
		const files = (await readdir(unavailDir)).filter((f) => f.endsWith('.yaml'));
		for (const f of files) {
			try {
				const u = await readYaml(`unavailability/${f}`, UnavailabilityFile);
				for (const e of u.entries) {
					if (!volunteerIds.has(e.volunteerId)) {
						errors.push(`unavailability/${f}: unknown volunteerId '${e.volunteerId}'`);
					}
				}
				console.log(`✓ unavailability/${f}: ${u.entries.length} entries`);
			} catch (err) {
				errors.push(`unavailability/${f}: ${(err as Error).message}`);
			}
		}
	} else {
		warnings.push('No unavailability/ directory yet — add when volunteers declare dates.');
	}

	// 5. Fairness (JSON)
	if (await exists('fairness')) {
		const fairDir = join(DATA_DIR, 'fairness');
		const files = (await readdir(fairDir)).filter((f) => f.endsWith('.json'));
		for (const f of files) {
			try {
				await readJson(`fairness/${f}`, FairnessLog);
				console.log(`✓ fairness/${f}`);
			} catch (err) {
				errors.push(`fairness/${f}: ${(err as Error).message}`);
			}
		}
	}

	// 6. Incidents (JSON)
	if (await exists('incidents')) {
		const incDir = join(DATA_DIR, 'incidents');
		const files = (await readdir(incDir)).filter((f) => f.endsWith('.json'));
		for (const f of files) {
			try {
				await readJson(`incidents/${f}`, Incident);
				console.log(`✓ incidents/${f}`);
			} catch (err) {
				errors.push(`incidents/${f}: ${(err as Error).message}`);
			}
		}
	}

	if (warnings.length) {
		console.log('\nwarnings:');
		for (const w of warnings) console.log(`  - ${w}`);
	}
	if (errors.length) {
		console.error('\nERRORS:');
		for (const e of errors) console.error(`  - ${e}`);
		process.exit(1);
	}
	console.log('\nAll data valid.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
