#!/usr/bin/env python3
"""
Supabase Security Scanner

Connects to a Supabase project's Postgres database and performs read-only
security checks (RLS, roles, extensions, storage buckets, auth settings).
Outputs a JSON report with a 0–100 score.

Usage:
    python3 supabase_scanner.py /path/to/scanner_config.yaml

Config YAML keys:
    project.ref             — Supabase project reference
    database.connection_string — Postgres connection URI
    api.service_role_key    — (optional) Service role key for REST API checks
    scanner.output.format   — "json"
    scanner.output.file     — path to write JSON report
    thresholds.minimum_score — minimum acceptable score
    thresholds.fail_on_critical — exit non-zero when critical issues found
"""

from __future__ import annotations

import json
import sys
import traceback
from dataclasses import dataclass, field
from typing import Any

import psycopg2  # type: ignore[import-untyped]
import yaml  # type: ignore[import-untyped]

# psycopg2 connection type alias (untyped C extension)
Connection = Any


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class Issue:
    check_id: str
    title: str
    severity: str  # critical | high | medium | low | info
    resource: str
    description: str
    remediation: str

    def to_dict(self) -> dict[str, str]:
        return {
            "check_id": self.check_id,
            "title": self.title,
            "severity": self.severity,
            "resource": self.resource,
            "description": self.description,
            "remediation": self.remediation,
        }


@dataclass
class CheckResult:
    check_id: str
    passed: bool
    issues: list[Issue] = field(default_factory=list)


# ── Security checks ──────────────────────────────────────────────────────────

def check_rls_policies(conn: Connection) -> CheckResult:
    """Verify that user-facing tables have RLS enabled."""
    check_id = "rls_enabled"
    issues: list[Issue] = []

    with conn.cursor() as cur:
        # Tables in public schema that do NOT have RLS enabled
        cur.execute("""
            SELECT c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'
              AND NOT c.relrowsecurity
            ORDER BY c.relname;
        """)
        for (table_name,) in cur.fetchall():
            issues.append(Issue(
                check_id=check_id,
                title=f"RLS not enabled on table '{table_name}'",
                severity="high",
                resource=f"public.{table_name}",
                description=(
                    f"Row Level Security is not enabled on table 'public.{table_name}'. "
                    "Without RLS, any authenticated user can read/write all rows."
                ),
                remediation=f"ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY;",
            ))

    return CheckResult(check_id=check_id, passed=len(issues) == 0, issues=issues)


def check_risky_extensions(conn: Connection) -> CheckResult:
    """Flag potentially dangerous Postgres extensions."""
    check_id = "risky_extensions"
    risky = {"dblink", "postgres_fdw", "file_fdw", "adminpack", "pg_cron", "plpython3u"}
    issues: list[Issue] = []

    with conn.cursor() as cur:
        cur.execute("SELECT extname FROM pg_extension ORDER BY extname;")
        for (ext,) in cur.fetchall():
            if ext in risky:
                issues.append(Issue(
                    check_id=check_id,
                    title=f"Risky extension '{ext}' installed",
                    severity="medium",
                    resource=f"extension.{ext}",
                    description=(
                        f"The extension '{ext}' can be used to access external "
                        "resources or execute arbitrary code."
                    ),
                    remediation=f"DROP EXTENSION IF EXISTS {ext};",
                ))

    return CheckResult(check_id=check_id, passed=len(issues) == 0, issues=issues)


def check_superuser_roles(conn: Connection) -> CheckResult:
    """Check for non-system superuser roles."""
    check_id = "superuser_roles"
    system_roles = {
        "postgres", "supabase_admin", "supabase_auth_admin",
        "supabase_storage_admin", "supabase_replication_admin",
        "supabase_read_only_user", "pgsodium_keymaker",
        "pgsodium_keyholder", "pgsodium_keyiduser",
        "supabase_realtime_admin", "supabase_functions_admin",
    }
    issues: list[Issue] = []

    with conn.cursor() as cur:
        cur.execute("""
            SELECT rolname FROM pg_roles
            WHERE rolsuper = true
            ORDER BY rolname;
        """)
        for (role,) in cur.fetchall():
            if role not in system_roles:
                issues.append(Issue(
                    check_id=check_id,
                    title=f"Non-system superuser role '{role}'",
                    severity="critical",
                    resource=f"role.{role}",
                    description=(
                        f"Role '{role}' has superuser privileges but is not a "
                        "known Supabase system role."
                    ),
                    remediation=f"ALTER ROLE {role} NOSUPERUSER;",
                ))

    return CheckResult(check_id=check_id, passed=len(issues) == 0, issues=issues)


def check_public_schema_permissions(conn: Connection) -> CheckResult:
    """Check for overly permissive grants on the public schema."""
    check_id = "public_schema_perms"
    issues: list[Issue] = []

    with conn.cursor() as cur:
        # Check if anon or authenticated roles have broad table permissions
        # without RLS policies
        cur.execute("""
            SELECT grantee, table_name, privilege_type
            FROM information_schema.table_privileges
            WHERE table_schema = 'public'
              AND grantee IN ('anon', 'authenticated')
              AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
            ORDER BY table_name, grantee;
        """)
        for grantee, table_name, priv in cur.fetchall():
            # Only flag if the table doesn't have RLS
            cur.execute("""
                SELECT relrowsecurity FROM pg_class
                WHERE relname = %s AND relnamespace = (
                    SELECT oid FROM pg_namespace WHERE nspname = 'public'
                );
            """, (table_name,))
            row = cur.fetchone()
            has_rls = row[0] if row else False
            if not has_rls:
                issues.append(Issue(
                    check_id=check_id,
                    title=f"'{grantee}' has {priv} on '{table_name}' without RLS",
                    severity="high",
                    resource=f"public.{table_name}",
                    description=(
                        f"Role '{grantee}' has {priv} privilege on "
                        f"'public.{table_name}' but RLS is not enabled."
                    ),
                    remediation=(
                        f"Enable RLS and create appropriate policies, or "
                        f"REVOKE {priv} ON public.{table_name} FROM {grantee};"
                    ),
                ))

    return CheckResult(check_id=check_id, passed=len(issues) == 0, issues=issues)


def check_storage_buckets(conn: Connection) -> CheckResult:
    """Check for public storage buckets."""
    check_id = "storage_buckets"
    issues: list[Issue] = []

    with conn.cursor() as cur:
        # storage.buckets table may not exist in all setups
        cur.execute("""
            SELECT EXISTS (
                SELECT FROM pg_tables
                WHERE schemaname = 'storage' AND tablename = 'buckets'
            );
        """)
        exists = cur.fetchone()[0]
        if not exists:
            return CheckResult(check_id=check_id, passed=True, issues=[])

        cur.execute("""
            SELECT name, public FROM storage.buckets ORDER BY name;
        """)
        for name, is_public in cur.fetchall():
            if is_public:
                issues.append(Issue(
                    check_id=check_id,
                    title=f"Storage bucket '{name}' is public",
                    severity="medium",
                    resource=f"storage.{name}",
                    description=(
                        f"Storage bucket '{name}' is publicly accessible. "
                        "Anyone with the URL can download files."
                    ),
                    remediation=(
                        f"UPDATE storage.buckets SET public = false "
                        f"WHERE name = '{name}';"
                    ),
                ))

    return CheckResult(check_id=check_id, passed=len(issues) == 0, issues=issues)


def check_auth_settings(conn: Connection) -> CheckResult:
    """Check auth schema for risky configurations."""
    check_id = "auth_settings"
    issues: list[Issue] = []

    with conn.cursor() as cur:
        # Check if auth.users table exists
        cur.execute("""
            SELECT EXISTS (
                SELECT FROM pg_tables
                WHERE schemaname = 'auth' AND tablename = 'users'
            );
        """)
        has_auth = cur.fetchone()[0]
        if not has_auth:
            return CheckResult(check_id=check_id, passed=True, issues=[])

        # Check for users with email_confirmed_at = NULL but active
        cur.execute("""
            SELECT COUNT(*) FROM auth.users
            WHERE email_confirmed_at IS NULL
              AND banned_until IS NULL;
        """)
        unconfirmed = cur.fetchone()[0]
        if unconfirmed > 0:
            issues.append(Issue(
                check_id=check_id,
                title=f"{unconfirmed} unconfirmed user(s) with active accounts",
                severity="low",
                resource="auth.users",
                description=(
                    f"There are {unconfirmed} user(s) with unconfirmed email "
                    "addresses that have not been banned."
                ),
                remediation="Enable email confirmation requirement in Supabase Auth settings.",
            ))

    return CheckResult(check_id=check_id, passed=len(issues) == 0, issues=issues)


def check_leaked_secrets_in_functions(conn: Connection) -> CheckResult:
    """Look for potential API keys or secrets in PL/pgSQL function bodies."""
    check_id = "function_secrets"
    issues: list[Issue] = []
    secret_patterns = [
        "password",
        "secret",
        "api_key",
        "apikey",
        "access_token",
        "private_key",
    ]

    with conn.cursor() as cur:
        cur.execute("""
            SELECT n.nspname, p.proname, pg_get_functiondef(p.oid) AS funcdef
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
            ORDER BY n.nspname, p.proname;
        """)
        for schema, func_name, funcdef in cur.fetchall():
            lower_def = funcdef.lower()
            for pattern in secret_patterns:
                if pattern in lower_def:
                    issues.append(Issue(
                        check_id=check_id,
                        title=f"Potential secret in function '{schema}.{func_name}'",
                        severity="medium",
                        resource=f"{schema}.{func_name}",
                        description=(
                            f"Function '{schema}.{func_name}' contains the term "
                            f"'{pattern}' which may indicate a hardcoded secret."
                        ),
                        remediation=(
                            "Move secrets to Supabase Vault or environment variables. "
                            "Do not hardcode secrets in function bodies."
                        ),
                    ))
                    break  # One finding per function is enough

    return CheckResult(check_id=check_id, passed=len(issues) == 0, issues=issues)


# ── Scoring ───────────────────────────────────────────────────────────────────

SEVERITY_WEIGHTS = {
    "critical": 15,
    "high": 10,
    "medium": 5,
    "low": 2,
    "info": 0,
}


def compute_score(issues: list[Issue]) -> int:
    """Compute a 0–100 security score. 100 = no issues."""
    penalty = sum(SEVERITY_WEIGHTS.get(i.severity, 0) for i in issues)
    return max(0, 100 - penalty)


# ── Main ──────────────────────────────────────────────────────────────────────

ALL_CHECKS = [
    check_rls_policies,
    check_risky_extensions,
    check_superuser_roles,
    check_public_schema_permissions,
    check_storage_buckets,
    check_auth_settings,
    check_leaked_secrets_in_functions,
]


def run_scanner(config_path: str) -> int:
    """Run all checks and write report. Returns exit code."""
    # Parse config
    with open(config_path) as f:
        config = yaml.safe_load(f)

    project_ref = config.get("project", {}).get("ref", "unknown")
    dsn = config.get("database", {}).get("connection_string")
    output_cfg = config.get("scanner", {}).get("output", {})
    output_file = output_cfg.get("file", "/data/report.json")
    thresholds = config.get("thresholds", {})
    minimum_score = thresholds.get("minimum_score", 0)
    fail_on_critical = thresholds.get("fail_on_critical", False)

    if not dsn:
        print("ERROR: database.connection_string is required", file=sys.stderr)
        return 1

    # Connect and run checks
    all_issues: list[Issue] = []
    passed = 0
    failed = 0
    skipped = 0

    try:
        conn = psycopg2.connect(dsn, connect_timeout=15)
        conn.set_session(readonly=True, autocommit=True)
    except Exception as exc:
        print(f"ERROR: Cannot connect to database: {exc}", file=sys.stderr)
        report = {
            "project_ref": project_ref,
            "score": 0,
            "summary": {
                "total_checks": len(ALL_CHECKS),
                "passed": 0,
                "failed": 0,
                "skipped": len(ALL_CHECKS),
            },
            "issues": [],
            "error": str(exc),
        }
        with open(output_file, "w") as f:
            json.dump(report, f, indent=2)
        return 1

    try:
        for check_fn in ALL_CHECKS:
            try:
                result = check_fn(conn)
                if result.passed:
                    passed += 1
                else:
                    failed += 1
                all_issues.extend(result.issues)
            except Exception as exc:
                skipped += 1
                print(
                    f"WARN: Check {check_fn.__name__} skipped: {exc}",
                    file=sys.stderr,
                )
                traceback.print_exc(file=sys.stderr)
    finally:
        conn.close()

    score = compute_score(all_issues)

    report = {
        "project_ref": project_ref,
        "score": score,
        "summary": {
            "total_checks": len(ALL_CHECKS),
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
        },
        "issues": [issue.to_dict() for issue in all_issues],
    }

    with open(output_file, "w") as f:
        json.dump(report, f, indent=2)

    # Also print to stdout for Docker logs
    print(json.dumps(report, indent=2))

    # Determine exit code
    has_critical = any(i.severity == "critical" for i in all_issues)
    if fail_on_critical and has_critical:
        return 2
    if score < minimum_score:
        return 2

    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <config.yaml>", file=sys.stderr)
        sys.exit(1)

    sys.exit(run_scanner(sys.argv[1]))
