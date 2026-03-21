package com.example.demo.service;

import com.example.demo.model.Task;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Service
public class TaskService {

    private final List<Task> tasks = new ArrayList<>();
    private long nextId = 1L;

    public List<Task> getAll() {
        return List.copyOf(tasks);
    }

    public Optional<Task> getById(long id) {
        return tasks.stream()
                .filter(t -> t.getId().equals(id))
                .findFirst();
    }

    public Task create(String title, String description) {
        Task task = new Task(nextId++, title, description);
        tasks.add(task);
        return task;
    }

    public Optional<Task> toggleComplete(long id) {
        return getById(id).map(task -> {
            task.setCompleted(!task.isCompleted());
            return task;
        });
    }

    public boolean delete(long id) {
        return tasks.removeIf(t -> t.getId().equals(id));
    }
}
