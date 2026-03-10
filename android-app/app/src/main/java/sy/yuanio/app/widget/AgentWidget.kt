package sy.yuanio.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews
import sy.yuanio.app.R

class AgentWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) mgr.updateAppWidget(id, buildViews(ctx, ctx.getString(R.string.widget_status_offline), ""))
    }

    companion object {
        fun refresh(ctx: Context, status: String, project: String?) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, AgentWidget::class.java))
            if (ids.isEmpty()) return
            val views = buildViews(ctx, status, project)
            for (id in ids) mgr.updateAppWidget(id, views)
        }

        private fun buildViews(ctx: Context, status: String, project: String?): RemoteViews {
            return RemoteViews(ctx.packageName, R.layout.widget_agent).apply {
                setTextViewText(R.id.widget_status, status)
                setTextViewText(R.id.widget_project, project ?: "")
            }
        }
    }
}

