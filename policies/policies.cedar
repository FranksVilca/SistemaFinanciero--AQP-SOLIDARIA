// Permit GESTOR to create and publish projects
permit (
    principal in FundacionAQPSolidaria::Group::"GESTOR",
    action in [
        FundacionAQPSolidaria::Action::"CreateProject",
        FundacionAQPSolidaria::Action::"PublishProject"
    ],
    resource is FundacionAQPSolidaria::Project
);

// Permit DONANTE to create donation intentions
permit (
    principal in FundacionAQPSolidaria::Group::"DONANTE",
    action == FundacionAQPSolidaria::Action::"CreateDonation",
    resource is FundacionAQPSolidaria::Donation
);

// Permit DONANTE to view or simulate their own donation (Ownership check)
permit (
    principal in FundacionAQPSolidaria::Group::"DONANTE",
    action in [
        FundacionAQPSolidaria::Action::"ViewDonation",
        FundacionAQPSolidaria::Action::"SimulateDonation"
    ],
    resource is FundacionAQPSolidaria::Donation
)
when {
    resource.donorSub == principal.id
};

// Permit AUDITOR to view audit events
permit (
    principal in FundacionAQPSolidaria::Group::"AUDITOR",
    action == FundacionAQPSolidaria::Action::"ViewAudit",
    resource is FundacionAQPSolidaria::AuditEvent
);
