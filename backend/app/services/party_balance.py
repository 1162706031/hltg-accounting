from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


PARTY_BALANCE_SQL = text(
    """
    SELECT
        p.id AS party_id,
        p.name AS party_name,
        CONCAT_WS(',',
            IF(p.is_internal,  'internal',  NULL),
            IF(p.is_customer,  'customer',  NULL),
            IF(p.is_supplier,  'supplier',  NULL),
            IF(p.is_processor, 'processor', NULL)
        ) AS party_type,

        COALESCE(recon.total_receivable, 0) AS total_receivable,
        COALESCE(recon.total_payable, 0) AS total_payable,
        COALESCE(pay.total_received, 0) AS total_received,
        COALESCE(pay.total_paid, 0) AS total_paid,
        COALESCE(recon.total_receivable, 0) - COALESCE(pay.total_received, 0) AS net_receivable,
        COALESCE(recon.total_payable, 0) - COALESCE(pay.total_paid, 0) AS net_payable,
        COALESCE(recon.accrued_issue, 0) - COALESCE(inv.actual_issued, 0) AS net_to_issue,
        COALESCE(recon.accrued_receive, 0) - COALESCE(inv.actual_received, 0) AS net_to_receive

    FROM party p
    LEFT JOIN (
        SELECT
            party_id,
            SUM(debit) AS total_receivable,
            SUM(credit) AS total_payable,
            SUM(CASE WHEN invoice_direction = 'issue' THEN COALESCE(invoice_amount, 0) ELSE 0 END) AS accrued_issue,
            SUM(CASE WHEN invoice_direction = 'receive' THEN COALESCE(invoice_amount, 0) ELSE 0 END) AS accrued_receive
        FROM party_reconciliation
        WHERE recon_status IN ('unreconciled', 'verified')
        GROUP BY party_id
    ) recon ON recon.party_id = p.id
    LEFT JOIN (
        SELECT
            party_id,
            -- payment.direction is from the selected party's perspective:
            -- pay = the party paid us, receive = the party received money from us.
            SUM(CASE WHEN direction = 'pay' THEN amount ELSE 0 END) AS total_received,
            SUM(CASE WHEN direction = 'receive' THEN amount ELSE 0 END) AS total_paid
        FROM payment
        GROUP BY party_id
    ) pay ON pay.party_id = p.id
    LEFT JOIN (
        SELECT
            party_id,
            SUM(CASE WHEN direction = 'issue' THEN amount ELSE 0 END) AS actual_issued,
            SUM(CASE WHEN direction = 'receive' THEN amount ELSE 0 END) AS actual_received
        FROM invoice
        GROUP BY party_id
    ) inv ON inv.party_id = p.id
    WHERE (:party_id IS NULL OR p.id = :party_id)
    ORDER BY p.id DESC
    """
)


async def list_party_balances(db: AsyncSession, party_id: int | None = None) -> list[dict]:
    result = await db.execute(PARTY_BALANCE_SQL, {"party_id": party_id})
    return [dict(row._mapping) for row in result]


async def get_party_balance_summary(db: AsyncSession, party_id: int) -> dict | None:
    rows = await list_party_balances(db, party_id=party_id)
    return rows[0] if rows else None
