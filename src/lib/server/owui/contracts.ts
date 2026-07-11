export type StudioUserRole = 'user' | 'admin';
export interface StudioUser {
	id: string;
	email: string;
	name: string;
	role: StudioUserRole;
	profileImageUrl: string | null;
}
export interface OwuiSession extends StudioUser {
	token: string;
	expiresAt: number | null;
}
export interface OwuiModel {
	id: string;
	name: string;
	kind: 'model' | 'agent';
	tags: string[];
}
export interface OwuiWorkspaceModel {
	id: string;
	baseModelId: string | null;
	name: string;
	tags: string[];
	isActive: boolean;
}
export interface OwuiFunction {
	id: string;
	isActive: boolean;
}
export interface OwuiFileSummary {
	id: string;
	filename: string;
	contentType: string | null;
	size: number | null;
	createdAt: number;
	updatedAt: number | null;
}
export interface OwuiKnowledgeSummary {
	id: string;
	name: string;
	description: string;
	writeAccess: boolean;
	createdAt: number;
	updatedAt: number;
}
export interface OwuiPage<T> {
	items: T[];
	total: number;
	page: number;
}
export interface OwuiChat {
	id: string;
	title: string;
	updatedAt: number;
}
