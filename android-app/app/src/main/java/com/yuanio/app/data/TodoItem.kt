package com.yuanio.app.data

import androidx.compose.runtime.Immutable

@Immutable
data class TodoItem(
    val id: String,
    val content: String,
    val status: String = "pending",   // "pending" | "in_progress" | "completed"
    val priority: String = "medium",  // "high" | "medium" | "low"
)
