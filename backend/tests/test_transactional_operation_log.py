import unittest

from sqlalchemy import create_engine, event, func, select
from sqlalchemy.exc import IntegrityError

from app.database import AuditedSession, Base, add_request_audit_log
from app.models.operation_log import OperationLog
from app.models.user import User
from app.utils.audit_context import new_audit_context, reset_audit_context, set_audit_context


class TransactionalOperationLogTests(unittest.TestCase):
    def test_audit_row_is_added_once_to_the_business_session(self):
        context = new_audit_context(
            user_id=7,
            action="UPDATE",
            target_type="item",
            target_id=12,
            summary="更新 item #12",
            detail={"request": {"name": "new name"}},
            ip_address="127.0.0.1",
        )
        token = set_audit_context(context)
        session = AuditedSession()
        try:
            add_request_audit_log(session)
            add_request_audit_log(session)

            logs = [row for row in session.new if isinstance(row, OperationLog)]
            self.assertEqual(len(logs), 1)
            self.assertEqual(logs[0].user_id, 7)
            self.assertEqual(logs[0].target_id, 12)
            self.assertEqual(session.info["audit_request_id"], context.request_id)
        finally:
            session.close()
            reset_audit_context(token)

    def test_session_without_request_context_gets_no_audit_row(self):
        session = AuditedSession()
        try:
            add_request_audit_log(session)
            self.assertFalse(any(isinstance(row, OperationLog) for row in session.new))
        finally:
            session.close()

    def test_rollback_allows_retry_to_add_the_audit_row_again(self):
        context = new_audit_context(
            user_id=7,
            action="CREATE",
            target_type="reconciliation",
            target_id=None,
            summary="创建 reconciliation",
            detail=None,
            ip_address=None,
        )
        token = set_audit_context(context)
        session = AuditedSession()
        try:
            add_request_audit_log(session)
            first_log = next(row for row in session.new if isinstance(row, OperationLog))
            session.rollback()

            add_request_audit_log(session)
            logs = [row for row in session.new if isinstance(row, OperationLog)]
            self.assertEqual(len(logs), 1)
            self.assertIsNot(logs[0], first_log)
        finally:
            session.close()
            reset_audit_context(token)

    def test_business_update_and_audit_log_commit_or_rollback_together(self):
        engine = create_engine("sqlite:///:memory:")

        @event.listens_for(engine, "connect")
        def enable_foreign_keys(dbapi_connection, _connection_record):
            dbapi_connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(engine, tables=[User.__table__, OperationLog.__table__])
        session = AuditedSession(bind=engine)
        try:
            actor = User(
                username="audit-actor",
                password="not-used-in-this-test",
                real_name="before",
                role="admin",
                is_active=True,
            )
            session.add(actor)
            session.commit()

            success_context = new_audit_context(
                user_id=actor.id,
                action="UPDATE",
                target_type="user",
                target_id=actor.id,
                summary=f"更新 user #{actor.id}",
                detail=None,
                ip_address=None,
            )
            token = set_audit_context(success_context)
            try:
                actor.real_name = "committed"
                session.commit()
            finally:
                reset_audit_context(token)

            self.assertEqual(session.scalar(select(func.count()).select_from(OperationLog)), 1)
            self.assertEqual(session.get(User, actor.id).real_name, "committed")

            failing_context = new_audit_context(
                user_id=999_999,
                action="UPDATE",
                target_type="user",
                target_id=actor.id,
                summary=f"更新 user #{actor.id}",
                detail=None,
                ip_address=None,
            )
            token = set_audit_context(failing_context)
            try:
                actor.real_name = "must-roll-back"
                with self.assertRaises(IntegrityError):
                    session.commit()
                session.rollback()
            finally:
                reset_audit_context(token)

            session.expire_all()
            self.assertEqual(session.get(User, actor.id).real_name, "committed")
            self.assertEqual(session.scalar(select(func.count()).select_from(OperationLog)), 1)
        finally:
            session.close()
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
