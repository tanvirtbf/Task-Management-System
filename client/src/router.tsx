import { lazy, Suspense, type ReactElement } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import Root from "./layouts/Root";
import AppShell from "./layouts/AppShell";
import AuthLayout from "./layouts/AuthLayout";
import PublicFormLayout from "./layouts/PublicFormLayout";
import RequireAuth from "./layouts/RequireAuth";
import RequirePermission from "./components/shared/RequirePermission";
import RequireGuest from "./layouts/RequireGuest";
// Auth pages — small, keep eager
import LoginPage from "./pages/auth/Login";
import ForgotPasswordPage from "./pages/auth/ForgotPassword";
import ResetPasswordPage from "./pages/auth/ResetPassword";
import AcceptInvitationPage from "./pages/auth/AcceptInvitation";
// Home + Task redirect — small, keep eager
import HomePage from "./pages/home/HomePage";
import TaskRedirect from "./pages/task/TaskRedirect";
import { RouteFallback } from "./components/shared/RouteFallback";

// Lazy pages
const SpacePage = lazy(() => import("./pages/space/SpacePage"));
const ListPage = lazy(() => import("./pages/list/ListPage"));
const FormsListPage = lazy(() => import("./pages/forms/FormsListPage"));
const FormBuilderPage = lazy(() => import("./pages/forms/FormBuilderPage"));
const PublicFormPage = lazy(() => import("./pages/public-form/PublicFormPage"));
const SettingsLayout = lazy(() => import("./pages/settings/SettingsLayout"));
const ProfileSettings = lazy(() => import("./pages/settings/ProfileSettings"));
const WorkspaceSettings = lazy(
    () => import("./pages/settings/WorkspaceSettings"),
);
const MembersSettings = lazy(() => import("./pages/settings/MembersSettings"));
const RolesSettings = lazy(() => import("./pages/settings/RolesSettings"));
const TaskTypesSettings = lazy(
    () => import("./pages/settings/TaskTypesSettings"),
);
const TagsSettings = lazy(() => import("./pages/settings/TagsSettings"));
const StatusesSettings = lazy(
    () => import("./pages/settings/StatusesSettings"),
);
const CustomFieldsSettings = lazy(
    () => import("./pages/settings/CustomFieldsSettings"),
);
const TemplatesSettings = lazy(
    () => import("./pages/settings/TemplatesSettings"),
);
const ImportExportSettings = lazy(
    () => import("./pages/settings/ImportExportSettings"),
);
const InboxPage = lazy(() => import("./pages/inbox/InboxPage"));
const SearchPage = lazy(() => import("./pages/search/SearchPage"));
const DepartmentPage = lazy(() => import("./pages/dept/DepartmentPage"));
const ReportsListPage = lazy(() => import("./pages/reports/ReportsListPage"));
const ReportDetailPage = lazy(
    () => import("./pages/reports/ReportDetailPage"),
);
const SlaQueuePage = lazy(() => import("./pages/sla/SlaQueuePage"));
const EngineeringHomePage = lazy(
    () => import("./pages/engineering/EngineeringHomePage"),
);
const SprintBoardPage = lazy(
    () => import("./pages/engineering/SprintBoardPage"),
);
const OnCallRotationPage = lazy(
    () => import("./pages/engineering/OnCallRotationPage"),
);

const lazyRoute = (node: ReactElement): ReactElement => (
    <Suspense fallback={<RouteFallback />}>{node}</Suspense>
);

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Root />,
        children: [
            // Public form — no auth, no app shell
            {
                element: <PublicFormLayout />,
                children: [
                    {
                        path: "forms/:slug",
                        element: lazyRoute(<PublicFormPage />),
                    },
                ],
            },

            // Guest-only auth pages
            {
                element: <RequireGuest />,
                children: [
                    {
                        element: <AuthLayout />,
                        children: [
                            { path: "login", element: <LoginPage /> },
                            {
                                path: "forgot-password",
                                element: <ForgotPasswordPage />,
                            },
                            {
                                path: "reset-password/:token",
                                element: <ResetPasswordPage />,
                            },
                            {
                                path: "invitation/:token",
                                element: <AcceptInvitationPage />,
                            },
                        ],
                    },
                ],
            },

            // Authenticated app shell
            {
                element: <RequireAuth />,
                children: [
                    {
                        element: <AppShell />,
                        children: [
                            { path: "", element: <HomePage /> },
                            { path: "inbox", element: lazyRoute(<InboxPage />) },
                            {
                                path: "search",
                                element: lazyRoute(<SearchPage />),
                            },
                            {
                                path: "dept",
                                element: lazyRoute(<DepartmentPage />),
                            },
                            {
                                path: "reports",
                                element: lazyRoute(<ReportsListPage />),
                            },
                            {
                                path: "reports/:reportId",
                                element: lazyRoute(<ReportDetailPage />),
                            },
                            {
                                // F28 (ISS-082, D12.4) — the breached-SLA queue.
                                // GET /sla/breached had no caller at all until
                                // this page existed.
                                path: "sla",
                                element: lazyRoute(<SlaQueuePage />),
                            },
                            {
                                path: "eng",
                                element: lazyRoute(<EngineeringHomePage />),
                            },
                            {
                                path: "eng/sprint",
                                element: lazyRoute(<SprintBoardPage />),
                            },
                            {
                                path: "eng/on-call",
                                element: lazyRoute(
                                    <RequirePermission permission="oncall.manage">
                                        <OnCallRotationPage />
                                    </RequirePermission>,
                                ),
                            },
                            {
                                path: "settings",
                                element: lazyRoute(<SettingsLayout />),
                                children: [
                                    {
                                        index: true,
                                        element: (
                                            <Navigate
                                                to="/settings/profile"
                                                replace
                                            />
                                        ),
                                    },
                                    {
                                        path: "profile",
                                        element: lazyRoute(<ProfileSettings />),
                                    },
                                    {
                                        path: "workspace",
                                        element: lazyRoute(
                                            <RequirePermission permission="workspace.settings">
                                                <WorkspaceSettings />
                                            </RequirePermission>,
                                        ),
                                    },
                                    {
                                        path: "members",
                                        element: lazyRoute(
                                            <RequirePermission permission="member.view">
                                                <MembersSettings />
                                            </RequirePermission>,
                                        ),
                                    },
                                    {
                                        path: "roles",
                                        element: lazyRoute(
                                            <RequirePermission permission="role.manage">
                                                <RolesSettings />
                                            </RequirePermission>,
                                        ),
                                    },
                                    {
                                        path: "task-types",
                                        element: lazyRoute(
                                            <RequirePermission permission="catalog.task_types">
                                                <TaskTypesSettings />
                                            </RequirePermission>,
                                        ),
                                    },
                                    {
                                        path: "tags",
                                        element: lazyRoute(
                                            <RequirePermission permission="catalog.tags">
                                                <TagsSettings />
                                            </RequirePermission>,
                                        ),
                                    },
                                    {
                                        path: "statuses",
                                        element: lazyRoute(
                                            <RequirePermission permission="status.manage">
                                                <StatusesSettings />
                                            </RequirePermission>,
                                        ),
                                    },
                                    {
                                        path: "custom-fields",
                                        element: lazyRoute(
                                            <RequirePermission permission="catalog.custom_fields">
                                                <CustomFieldsSettings />
                                            </RequirePermission>,
                                        ),
                                    },
                                    {
                                        path: "templates",
                                        element: lazyRoute(
                                            <RequirePermission permission="catalog.templates">
                                                <TemplatesSettings />
                                            </RequirePermission>,
                                        ),
                                    },
                                    {
                                        path: "import-export",
                                        element: lazyRoute(
                                            <ImportExportSettings />,
                                        ),
                                    },
                                ],
                            },
                            {
                                path: "s/:spaceId",
                                element: lazyRoute(<SpacePage />),
                            },
                            {
                                path: "s/:spaceId/l/:listId",
                                element: lazyRoute(<ListPage />),
                            },
                            {
                                path: "s/:spaceId/l/:listId/:viewId",
                                element: lazyRoute(<ListPage />),
                            },
                            { path: "t/:taskKey", element: <TaskRedirect /> },

                            // Forms management
                            {
                                path: "forms",
                                element: lazyRoute(<FormsListPage />),
                            },
                            {
                                path: "forms/:formId/edit",
                                element: lazyRoute(<FormBuilderPage />),
                            },
                        ],
                    },
                ],
            },

            { path: "*", element: <Navigate to="/" replace /> },
        ],
    },
]);
