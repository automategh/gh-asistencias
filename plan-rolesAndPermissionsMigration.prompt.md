# Plan

La recomendación es migrar en dos capas al mismo tiempo: catálogo de roles y permisos en BD, y consumo de permisos en cliente + reglas de Firebase. Con las decisiones ya tomadas, el diseño base queda así: un solo rol por usuario, CRUD de roles desde UI, catálogo de permisos persistido en BD, y validación incluida desde la primera versión también en reglas/servicios.

## Fases

1. Congelar la matriz actual de acceso y normalizar inconsistencias.
   - Hoy el sistema tiene choques, por ejemplo [src/App.tsx](src/App.tsx) permite entrar a permisos con Admin y HR, pero [src/components/layouts/sidebar.tsx](src/components/layouts/sidebar.tsx) solo muestra ese link a Admin.
   - En esta fase se documenta todo lo que hoy depende de rol: rutas, sidebar, botones, reportes, reglas y acciones de reuniones.

2. Definir el catálogo inicial de permisos por dominio.
   - La idea no es crear permisos por pantalla sino por capacidad: ver dashboard, crear actividades, ver asistencias, gestionar reuniones propias, gestionar reuniones globales, ver reportes de equipo, ver reportes globales, administrar encuestas, administrar departamentos, administrar agrupaciones, ver usuarios, activar usuarios, asignar roles, administrar roles.
   - También hay que separar permisos estáticos de reglas contextuales. Ejemplo: cerrar una reunión no es solo permiso; además depende de si el usuario es creador o manager. Eso hoy está embebido en [src/pages/meets/DetailMeetPage.tsx](src/pages/meets/DetailMeetPage.tsx).

3. Evaluar cada rol actual y convertirlo en permisos iniciales.
   - Admin: acceso total y administración del catálogo de roles.
   - HR: administración operativa de usuarios, asignación de roles a usuarios, reportes globales, encuestas admin, departamentos, agrupaciones y operación de actividades.
   - Lider: reportes de equipo, creación de actividades, asistencias y gestión de actividades propias o donde sea manager.
   - Instructor: creación de actividades, asistencias y gestión de actividades propias o donde sea manager.
   - User: dashboard, perfil, actividades, checkin y responder encuestas.
   - Recomendación: separar administrar catálogo de roles de asignar rol a usuarios. Es decir, HR puede asignar roles a usuarios, pero el CRUD del catálogo de roles queda solo para Admin.

4. Persistir roles y permisos en Realtime Database sin romper compatibilidad.
   - Mantener temporalmente el campo actual de usuario y añadir un identificador nuevo de rol.
   - Persistir un nodo de roles con nombre, descripción, estado, bandera de sistema y mapa de permisos.
   - Persistir un nodo de definiciones de permisos para que la UI no dependa de código.
   - Importante: no usar ids de permiso con punto como clave de RTDB; deben ser ids válidos para Firebase.
   - Como hoy la app opera por recinto/base, el catálogo debe sembrarse en todas las bases configuradas.

5. Crear una capa única de autorización en cliente.
   - [src/context/AuthContext.tsx](src/context/AuthContext.tsx) debe dejar de cargar solo role y pasar a cargar rol resuelto + permisos.
   - [src/components/auth/role-route.tsx](src/components/auth/role-route.tsx) debe migrar a un guard por permisos o a un wrapper compatible durante transición.
   - [src/App.tsx](src/App.tsx) y [src/components/layouts/sidebar.tsx](src/components/layouts/sidebar.tsx) deben dejar de depender de arrays hardcodeados por rol.

6. Migrar primero los consumos más sensibles.
   - [src/pages/meets/DetailMeetPage.tsx](src/pages/meets/DetailMeetPage.tsx): extraer canClose, canCancel, canReopen, canComplete y acceso a asistencia a un evaluador por permisos + ownership.
   - [src/pages/reports/ReportTrainingPlanPage.tsx](src/pages/reports/ReportTrainingPlanPage.tsx), [src/pages/reports/ReportGroupPage.tsx](src/pages/reports/ReportGroupPage.tsx) y [src/pages/reports/ReportIndividualPage.tsx](src/pages/reports/ReportIndividualPage.tsx): reemplazar la lógica de role igual a Lider por permisos de alcance de equipo.
   - [src/pages/configuration/ConfigurationPage.tsx](src/pages/configuration/ConfigurationPage.tsx): eliminar traducciones y switches dependientes del string del rol.

7. Rediseñar el módulo de permisos como módulo de roles y permisos.
   - [src/pages/permissions/PermissionsPage.tsx](src/pages/permissions/PermissionsPage.tsx) debe separarse en dos capacidades:
   - Asignación de rol a usuarios.
   - CRUD de roles y configuración de permisos por rol.
   - [src/services/roles.service.ts](src/services/roles.service.ts) debe dividirse o ampliarse para soportar catálogo de roles, permisos y asignaciones sin seguir escribiendo solo users/{uid}/role.


8. Retirar hardcodes y compatibilidad temporal.
   - Cuando la matriz nueva esté validada, se elimina el rol hardcodeado como fuente de verdad.
   - Se retiran selects con opciones fijas, arrays allowed por rol y comparaciones inline por string.

## Archivos clave

- [src/context/AuthContext.tsx](src/context/AuthContext.tsx)
- [src/components/auth/role-route.tsx](src/components/auth/role-route.tsx)
- [src/App.tsx](src/App.tsx)
- [src/components/layouts/sidebar.tsx](src/components/layouts/sidebar.tsx)
- [src/services/roles.service.ts](src/services/roles.service.ts)
- [src/pages/permissions/PermissionsPage.tsx](src/pages/permissions/PermissionsPage.tsx)
- [src/pages/meets/DetailMeetPage.tsx](src/pages/meets/DetailMeetPage.tsx)
- [src/pages/reports/ReportTrainingPlanPage.tsx](src/pages/reports/ReportTrainingPlanPage.tsx)
- [src/pages/reports/ReportGroupPage.tsx](src/pages/reports/ReportGroupPage.tsx)
- [src/pages/reports/ReportIndividualPage.tsx](src/pages/reports/ReportIndividualPage.tsx)
- [src/pages/configuration/ConfigurationPage.tsx](src/pages/configuration/ConfigurationPage.tsx)
- [src/types/permissions.d.ts](src/types/permissions.d.ts)
- [database.rules.json](database.rules.json)

## Verificación

1. Sembrar roles y permisos en todas las bases y comprobar que los usuarios existentes siguen entrando durante la transición.
2. Probar la matriz manual por rol: Admin, HR, Lider, Instructor y User.
3. Intentar operaciones prohibidas para confirmar que las reglas de Firebase bloquean, no solo la UI.
4. Crear un rol nuevo desde UI, asignarle permisos, asignarlo a un usuario y verificar que navegación, rutas y acciones cambian sin tocar código.
5. Confirmar que los casos contextuales de reuniones siguen funcionando bien con creador y managers, no solo con permisos globales.

## Decisiones tomadas

- Un solo rol por usuario.
- CRUD de roles desde UI y asignación de permisos por rol.
- Catálogo de permisos persistido en BD.
- La primera versión incluye cliente y reglas/servicios, no solo UI.
- Recomendación de gobierno: separar roles_manage de users_assign_role para que HR pueda asignar roles a usuarios sin editar el catálogo global de roles.
- Compatibilidad temporal con el campo actual de rol mientras se migra a roleId.
- Siembra del mismo catálogo base en todas las bases configuradas.

## Siguiente paso sugerido

Convertir este plan en backlog de implementación por fases, con orden exacto de archivos, tareas técnicas y estrategia de migración de datos para ejecutarlo sin romper producción.
