package com.example.demo.service

import org.springframework.stereotype.Service
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

@Service
class GreetingService {

    private val greetings = mutableListOf<Greeting>()
    private var nextId = 1L

    fun getAll(): List<Greeting> {
        return greetings.toList()
    }

    fun getById(id: Long): Greeting? {
        return greetings.find { it.id == id }
    }

    fun create(name: String, language: String): Greeting {
        val message = buildGreeting(name, language)
        val greeting = Greeting(
            id = nextId++,
            name = name,
            language = language,
            message = message,
            createdAt = LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME)
        )
        greetings.add(greeting)
        return greeting
    }

    fun delete(id: Long): Boolean {
        return greetings.removeIf { it.id == id }
    }

    private fun buildGreeting(name: String, language: String): String {
        val template = when (language.lowercase()) {
            "ja" -> "こんにちは、%sさん！"
            "en" -> "Hello, %s!"
            "fr" -> "Bonjour, %s!"
            "de" -> "Hallo, %s!"
            "es" -> "¡Hola, %s!"
            "zh" -> "你好，%s！"
            "ko" -> "안녕하세요, %s님!"
            else -> "Hello, %s!"
        }
        return template.format(name)
    }
}

data class Greeting(
    val id: Long,
    val name: String,
    val language: String,
    val message: String,
    val createdAt: String
)
