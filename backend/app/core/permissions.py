SYSTEM = "system.all"

ORG_MANAGE = "org.manage"
ORG_SCHEDULE_VIEW_ALL = "org.schedule.view_all"
ORG_SCHEDULE_ARRANGE = "org.schedule.arrange"
ORG_EMPLOYEE_MANAGE = "org.employee.manage"

STORE_SCHEDULE_VIEW = "store.schedule.view"
STORE_SCHEDULE_EDIT = "store.schedule.edit"
STORE_DEMAND_EDIT = "store.demand.edit"
STORE_DEADLINE_MANAGE = "store.schedule.deadline.manage"

SELF_SCHEDULE_VIEW = "self.schedule.view"
SELF_AVAILABILITY_EDIT = "self.availability.edit"
SELF_PREFERENCE_EDIT = "self.preference.edit"
SELF_PROFILE_EDIT = "self.profile.edit"

EMPLOYEE_AVAILABILITY_EDIT = "employee.availability.edit"
EMPLOYEE_PREFERENCE_EDIT = "employee.preference.edit"
EMPLOYEE_PAYROLL_VIEW = "employee.payroll.view"
EMPLOYEE_CONTRACT_EDIT = "employee.contract.edit"

ALL_PERMISSIONS: frozenset[str] = frozenset({
    SYSTEM,
    ORG_MANAGE, ORG_SCHEDULE_VIEW_ALL, ORG_SCHEDULE_ARRANGE, ORG_EMPLOYEE_MANAGE,
    STORE_SCHEDULE_VIEW, STORE_SCHEDULE_EDIT, STORE_DEMAND_EDIT, STORE_DEADLINE_MANAGE,
    SELF_SCHEDULE_VIEW, SELF_AVAILABILITY_EDIT, SELF_PREFERENCE_EDIT, SELF_PROFILE_EDIT,
    EMPLOYEE_AVAILABILITY_EDIT, EMPLOYEE_PREFERENCE_EDIT, EMPLOYEE_PAYROLL_VIEW, EMPLOYEE_CONTRACT_EDIT,
})
