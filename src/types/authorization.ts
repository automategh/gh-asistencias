import type { RecintoKey } from "@/lib/firebase/databaseResolver"

export type PermissionCategory =
  | "dashboard"
  | "profile"
  | "meetings"
  | "reports"
  | "surveys"
  | "configuration"
  | "users"
  | "roles"

export type PermissionId =
  | "dashboard_view"
  | "profile_edit_self"
  | "meetings_view"
  | "meetings_create"
  | "meetings_attendance_view"
  | "meetings_manage_owned"
  | "meetings_manage_any"
  | "reports_view_team"
  | "reports_view_all"
  | "surveys_respond"
  | "surveys_admin_view"
  | "surveys_create"
  | "surveys_edit"
  | "surveys_results_view"
  | "departments_manage"
  | "user_grouping_manage"
  | "users_view"
  | "users_activate"
  | "users_deactivate"
  | "users_assign_role"
  | "roles_view"
  | "roles_manage"

export type RoleId = "admin" | "hr" | "lider" | "instructor" | "user" | string

export type RoleScope = "global" | "local"

export interface PermissionDefinition {
  readonly id: PermissionId
  readonly label: string
  readonly description: string
  readonly category: PermissionCategory
  readonly system: boolean
  readonly active: boolean
}

export type PermissionMap = Partial<Record<PermissionId, boolean>>

export interface RoleDefinition {
  readonly id: RoleId
  readonly name: string
  readonly displayName: string
  readonly description: string
  readonly scope: RoleScope
  readonly syncKey: string
  readonly system: boolean
  readonly active: boolean
  readonly permissions: PermissionMap
  readonly createdAt: string
  readonly updatedAt: string
}

export interface RoleSeed {
  readonly id: RoleId
  readonly name: string
  readonly displayName: string
  readonly description: string
  readonly scope: RoleScope
  readonly syncKey: string
  readonly system: boolean
  readonly active: boolean
  readonly permissions: PermissionMap
}

export interface AuthorizationCatalogSnapshot {
  readonly permissions: PermissionDefinition[]
  readonly roles: RoleDefinition[]
}

export interface ManageableRoleDefinition extends RoleDefinition {
  readonly sourceDatabaseUrl: string
  readonly sourceRecinto: RecintoKey
  readonly availableInDatabaseUrls: readonly string[]
  readonly availableInRecintos: readonly RecintoKey[]
}

export interface UserAuthorizationAssignment {
  readonly roleId: RoleId
}