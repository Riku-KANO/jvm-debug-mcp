package com.example.demo.controller

import com.example.demo.service.Greeting
import com.example.demo.service.GreetingService
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/greetings")
class GreetingController(private val greetingService: GreetingService) {

    @GetMapping
    fun getAll(): List<Greeting> {
        return greetingService.getAll()
    }

    @GetMapping("/{id}")
    fun getById(@PathVariable id: Long): ResponseEntity<Greeting> {
        val greeting = greetingService.getById(id)
            ?: return ResponseEntity.notFound().build()
        return ResponseEntity.ok(greeting)
    }

    @PostMapping
    fun create(@RequestBody request: CreateGreetingRequest): ResponseEntity<Greeting> {
        val greeting = greetingService.create(request.name, request.language)
        return ResponseEntity.status(HttpStatus.CREATED).body(greeting)
    }

    @DeleteMapping("/{id}")
    fun delete(@PathVariable id: Long): ResponseEntity<Void> {
        return if (greetingService.delete(id)) {
            ResponseEntity.noContent().build()
        } else {
            ResponseEntity.notFound().build()
        }
    }
}

data class CreateGreetingRequest(
    val name: String,
    val language: String = "en"
)
