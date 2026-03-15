# SwimNote — Nationwide Swimming Pool Online Integrated Management Platform

## Overview
SwimNote is a multi-tenant B2B SaaS platform designed for comprehensive management of swimming pools. It aims to streamline operations for various user roles including super_admin, platform_admin, pool_admin, teacher, and parent_account, with a Korean UI. The platform facilitates the entire lifecycle from swimming pool application and approval to daily operations like class management, attendance, and communication. It provides robust multi-tenancy at the database level and a flexible permission system for platform administrators. The business vision is to become the leading integrated management solution for swimming facilities, offering efficiency and an enhanced experience for administrators, teachers, and parents.

## User Preferences
I prefer the AI to operate with a clear understanding of the existing system's multi-tenancy and role-based access control. When implementing new features or modifying existing ones, prioritize maintaining data isolation and security across different swimming pools and user roles. I expect the AI to maintain a consistent API response format and to automatically record activity logs for significant actions, especially status changes and data modifications.

## System Architecture

### UI/UX Decisions
The administrator application features a 5-tab structure (Dashboard, People, Classes, Communication, More) with additional hidden routes for detailed management. A consistent selection mode UX is implemented for bulk actions like deletion, featuring a common selection hook, a fixed action bar, and clear visual feedback for selected items. The member detail screen is a comprehensive 8-tab hub for managing individual student information, including personal details, class info, makeup lessons, parent sharing, and activity logs.

### Technical Implementations
The platform is built as a pnpm workspace monorepo using TypeScript. It leverages Node.js 24, pnpm, TypeScript 5.9, Express 5 for the API server, PostgreSQL with Drizzle ORM for the database, Zod for validation, and Orval for API codegen. Esbuild is used for CJS bundling. Object storage is integrated for managing photos, with distinct album types (group and private) and corresponding access controls.

### Feature Specifications
- **Role-Based Access Control**: Differentiated permissions for `super_admin`, `platform_admin`, `pool_admin`, `teacher`, and `parent_account`. `platform_admin` permissions are granularly configurable.
- **Swimming Pool Approval Flow**: A multi-step process for new swimming pool registrations, involving administrator account creation, detailed application submission, super_admin approval/rejection, and login restriction based on approval status.
- **Multi-tenancy**: Achieved at the database level by including `swimming_pool_id` in all relevant tables, ensuring data isolation.
- **Photo Album System**: Supports both group and private photo albums with access control based on user roles and student/class assignments. Utilizes a dedicated object storage client for file uploads and downloads.
- **Makeup Lesson System**: Automated creation of makeup lesson requests upon student absence, with comprehensive lifecycle management (waiting, assigned, transferred, completed, cancelled) via dedicated API endpoints.
- **Activity Logging**: Automated tracking of significant administrator actions (e.g., status changes, information edits, restorations) in a `member_activity_logs` table, providing a detailed audit trail.

### System Design Choices
- **API Design**: RESTful API endpoints with clear responsibilities, consistent JSON response formats (success/failure), and strong authentication/authorization middleware.
- **Database Schema**: PostgreSQL with Drizzle ORM, featuring key tables for swimming pools, users, students, classes, attendance, photos, and activity logs, all designed with `swimming_pool_id` for multi-tenancy.
- **Security**: Robust security measures including JWT-based authentication, role and pool access checks, API validation, and login restrictions based on pool approval status.
- **Modular Structure**: A monorepo setup with `artifacts` for deployable applications, `lib` for shared libraries, and `packages` for shared components, promoting code reusability and maintainability.

## External Dependencies
- **PostgreSQL**: Primary database for all application data.
- **Drizzle ORM**: Object-relational mapper for interacting with PostgreSQL.
- **Express 5**: Web application framework for the API server.
- **Zod**: Schema declaration and validation library.
- **Orval**: OpenAPI code generator for API clients.
- **Google Cloud Storage (GCS) or equivalent**: Object storage for managing student and class photos. (Indicated by `new Client({ bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID })`)