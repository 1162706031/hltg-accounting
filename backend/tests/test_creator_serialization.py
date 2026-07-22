import unittest
from types import SimpleNamespace

from app.schemas.common import ORMModel
from app.services.creator import serialize_with_creator_names


class DummySchema(ORMModel):
    id: int
    created_by: int | None
    created_by_name: str | None = None


class FakeResult:
    def all(self):
        return [
            (1, "张三", "zhangsan"),
            (2, None, "lisi"),
        ]


class FakeSession:
    async def execute(self, _statement):
        return FakeResult()


class CreatorSerializationTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_name_then_username_is_used_without_per_row_queries(self):
        records = [
            SimpleNamespace(id=10, created_by=1),
            SimpleNamespace(id=11, created_by=2),
            SimpleNamespace(id=12, created_by=None),
        ]
        result = await serialize_with_creator_names(  # type: ignore[arg-type]
            FakeSession(), records, DummySchema
        )
        self.assertEqual(
            [row.created_by_name for row in result],
            ["张三", "lisi", None],
        )


if __name__ == "__main__":
    unittest.main()
