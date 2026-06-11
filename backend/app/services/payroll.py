import uuid
from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.payroll import ContractType, EmployeeContract, PayrollReport
from app.models.schedule import Assignment, Schedule


async def create_payroll_reports(schedule: Schedule, db: AsyncSession) -> None:
    """Generate or update PayrollReport records for every assigned user in this schedule.

    - FT:     gross_pay = monthly_salary_snapshot (reference value, not prorated by week)
    - PT:     gross_pay = total_hours × hourly_rate_snapshot
    - CUSTOM: gross_pay = None  (hours tracked, no pay terms)
    - No contract: skipped entirely
    """
    assignments_result = await db.execute(
        select(Assignment).where(Assignment.schedule_id == schedule.id)
    )
    assignments = assignments_result.scalars().all()

    hours_map: dict[tuple[uuid.UUID, uuid.UUID], int] = {}
    for a in assignments:
        key = (a.user_id, a.store_id)
        hours_map[key] = hours_map.get(key, 0) + 1

    if not hours_map:
        return

    user_ids = list({uid for uid, _ in hours_map})

    contracts_result = await db.execute(
        select(EmployeeContract)
        .where(
            EmployeeContract.user_id.in_(user_ids),
            EmployeeContract.effective_from <= schedule.week_start,
            or_(
                EmployeeContract.effective_until.is_(None),
                EmployeeContract.effective_until >= schedule.week_start,
            ),
        )
        .order_by(EmployeeContract.effective_from.desc())
    )
    contract_map: dict[uuid.UUID, EmployeeContract] = {}
    for c in contracts_result.scalars():
        if c.user_id not in contract_map:  # sorted desc — first wins
            contract_map[c.user_id] = c

    for (user_id, store_id), total_hours in hours_map.items():
        contract = contract_map.get(user_id)
        if not contract:
            continue

        hours_dec = Decimal(total_hours)
        if contract.contract_type == ContractType.FT:
            monthly_salary_snapshot = contract.monthly_salary
            hourly_rate_snapshot = None
            gross: Decimal | None = contract.monthly_salary
        elif contract.contract_type == ContractType.PT:
            monthly_salary_snapshot = None
            hourly_rate_snapshot = contract.hourly_rate
            gross = (hours_dec * contract.hourly_rate).quantize(Decimal("0.01"))
        else:  # CUSTOM — track hours, no pay
            monthly_salary_snapshot = None
            hourly_rate_snapshot = None
            gross = None

        existing_result = await db.execute(
            select(PayrollReport).where(
                PayrollReport.user_id == user_id,
                PayrollReport.store_id == store_id,
                PayrollReport.week_start == schedule.week_start,
            )
        )
        report = existing_result.scalar_one_or_none()

        if report:
            report.total_hours = hours_dec
            report.contract_type = contract.contract_type
            report.monthly_salary_snapshot = monthly_salary_snapshot
            report.hourly_rate_snapshot = hourly_rate_snapshot
            report.gross_pay = gross
        else:
            db.add(PayrollReport(
                user_id=user_id,
                store_id=store_id,
                week_start=schedule.week_start,
                total_hours=hours_dec,
                contract_type=contract.contract_type,
                monthly_salary_snapshot=monthly_salary_snapshot,
                hourly_rate_snapshot=hourly_rate_snapshot,
                gross_pay=gross,
            ))
