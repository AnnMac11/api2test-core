import { StorageProvider } from '../adapters/StorageProvider';

/**
 * Named deploy destinations (REG-1) — where a test set can be deployed: a name the user picks
 * ("E2E", "Pre-prod"), a git repo + branch, and a path inside that repo. Set up once in Admin;
 * at deploy time the user selects the destination and its stored path is used — nothing is asked
 * per deploy. Optionally linked to an environment. Shared by every edition via {@link StorageProvider}
 * (File/SQL/Mongo). The push itself is REG-2; results ingestion is REG-3.
 */
export interface DeployDestinationDto {
  id: string;
  /** Unique display name (case-insensitive) — the deploy picker keys off it. */
  name: string;
  /** Git repository the test set is pushed to. */
  repoUrl: string;
  /** Branch to push to. Defaults to `main`. */
  branch: string;
  /** Path inside the repo the unit is written under. Empty = repo root. */
  path: string;
  /** Optional link to an environment (the app's environments collection). */
  environmentId?: string;
  description?: string;
}

/** What a caller supplies — id/branch/path are filled in. */
export type DeployDestinationInput = Omit<DeployDestinationDto, 'id' | 'branch' | 'path'> &
  Partial<Pick<DeployDestinationDto, 'branch' | 'path'>> & { id?: string };

const COLLECTION = 'deploy-destinations.json';

export class DeployDestinationService {
  constructor(private storage: StorageProvider) {}

  async list(): Promise<DeployDestinationDto[]> {
    return this.storage.readJsonFile<DeployDestinationDto>(COLLECTION);
  }

  async getById(id: string): Promise<DeployDestinationDto | undefined> {
    return this.storage.getItemById<DeployDestinationDto>(COLLECTION, id);
  }

  /** Case-insensitive name lookup — the one-click / picker deploy flows resolve by name. */
  async getByName(name: string): Promise<DeployDestinationDto | undefined> {
    const key = name.trim().toLowerCase();
    return (await this.list()).find(d => d.name.toLowerCase() === key);
  }

  async add(input: DeployDestinationInput): Promise<DeployDestinationDto> {
    const dest = this.normalise(input);
    if (await this.getByName(dest.name)) {
      throw new Error(`A destination named "${dest.name}" already exists.`);
    }
    const item = { ...dest, id: input.id || `dest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` };
    await this.storage.addItem(COLLECTION, item);
    return item;
  }

  /** Patch an existing destination. Rename is checked against the other destinations. */
  async update(id: string, patch: Partial<Omit<DeployDestinationDto, 'id'>>): Promise<DeployDestinationDto> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`No deploy destination with id "${id}".`);
    const merged = this.normalise({ ...existing, ...patch });
    const clash = await this.getByName(merged.name);
    if (clash && clash.id !== id) {
      throw new Error(`A destination named "${merged.name}" already exists.`);
    }
    const item = { ...merged, id };
    await this.storage.updateItem(COLLECTION, id, item);
    return item;
  }

  async remove(id: string): Promise<void> {
    await this.storage.deleteItem(COLLECTION, id);
  }

  /**
   * Create-on-first-use: returns the existing destination of that name, or creates it. An existing
   * definition WINS — a deploy prompt can never silently redefine where a name points.
   */
  async getOrCreate(input: DeployDestinationInput): Promise<DeployDestinationDto> {
    return (await this.getByName(input.name)) ?? this.add(input);
  }

  private normalise(input: DeployDestinationInput): Omit<DeployDestinationDto, 'id'> {
    const name = (input.name || '').trim();
    if (!name) throw new Error('Destination name is required.');
    const repoUrl = (input.repoUrl || '').trim();
    if (!repoUrl) throw new Error('Destination repo URL is required.');
    return {
      name,
      repoUrl,
      branch: (input.branch || '').trim() || 'main',
      path: (input.path || '').trim(),
      ...(input.environmentId ? { environmentId: input.environmentId } : {}),
      ...(input.description ? { description: input.description } : {}),
    };
  }
}
