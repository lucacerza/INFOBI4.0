"""
Test d'integrazione: persistenza del widget_type (Fase 1.5).
Verifica end-to-end che il cambio tipo widget venga salvato e riletto.
"""


def _create_dashboard(client, auth_headers, name):
    res = client.post("/api/dashboards", json={"name": name, "description": ""}, headers=auth_headers)
    assert res.status_code in (200, 201), res.text
    return res.json()["id"]


def _add_widget(client, auth_headers, dash_id, widget_type="grid"):
    res = client.post(
        f"/api/dashboards/{dash_id}/widgets",
        json={
            "report_id": 1,
            "title": "W",
            "widget_type": widget_type,
            "config": {},
            "position": {"x": 0, "y": 0, "w": 6, "h": 4},
        },
        headers=auth_headers,
    )
    assert res.status_code in (200, 201), res.text
    return res.json()


def test_widget_type_is_persisted(client, auth_headers):
    dash_id = _create_dashboard(client, auth_headers, "Test persistenza")
    widget = _add_widget(client, auth_headers, dash_id, "grid")
    wid = widget["id"]
    assert widget["widget_type"] == "grid"

    # Cambia tipo grid -> chart
    res = client.put(
        f"/api/dashboards/{dash_id}/widgets/{wid}",
        json={"widget_type": "chart"},
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["widget_type"] == "chart"

    # Rilettura fresca della dashboard: deve risultare persistito
    res = client.get(f"/api/dashboards/{dash_id}", headers=auth_headers)
    assert res.status_code == 200, res.text
    widgets = res.json()["widgets"]
    saved = next(w for w in widgets if w["id"] == wid)
    assert saved["widget_type"] == "chart"


def test_widget_type_invalid_is_rejected(client, auth_headers):
    dash_id = _create_dashboard(client, auth_headers, "Test validazione")
    wid = _add_widget(client, auth_headers, dash_id, "grid")["id"]

    res = client.put(
        f"/api/dashboards/{dash_id}/widgets/{wid}",
        json={"widget_type": "bogus"},
        headers=auth_headers,
    )
    assert res.status_code == 400, res.text
